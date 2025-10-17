# Rewindex - Functional Requirements Document
### Lightning-Fast Code Search for LLM Agents

> **Name:** Rewindex - because it helps you understand what's in rewindex, rewindex out your codebase, and maintain proper variable rewindex in your searches.

## Executive Summary

Rewindex is a local Elasticsearch-based code indexing and search service that provides intelligent, fast code search capabilities for LLM agents and developers. The system maintains a real-time indexed view of codebases with file watching, offers both simple and advanced query interfaces, and provides observability through a lightweight web UI.

## System Architecture

### Core Philosophy
Keep the document simple: the indexed document is just the file content. Everything else is metadata fields that can be filtered. This approach ensures compatibility with standard Elasticsearch analyzers, simplifies debugging, and provides a clean mental model for both LLMs and developers.

#### Example Indexed Document
```json
{
  "_id": "a3f5c9d8...",  // content_hash
  "_source": {
    // The searchable content - just the raw file
    "content": "import hashlib\nimport jwt\n\nclass AuthService:\n    def authenticate(self, username, password):\n        # TODO: Add rate limiting\n        hashed = hashlib.sha256(password.encode()).hexdigest()\n        return self.check_password(username, hashed)\n",
    
    // Simple metadata fields
    "file_path": "src/services/auth.py",
    "file_name": "auth.py",
    "extension": ".py",
    "language": "python",
    "size_bytes": 234,
    "line_count": 8,
    "last_modified": "2024-01-15T10:30:00Z",
    
    // Extracted via regex (fast, simple, good enough)
    "imports": ["hashlib", "jwt"],
    "defined_classes": ["AuthService"],
    "defined_functions": ["authenticate"],
    "todos": ["Add rate limiting"],
    
    // Version tracking
    "content_hash": "a3f5c9d8...",
    "is_current": true,
    
    // Project context
    "project_id": "proj_123",
    "git_commit": "abc123"
  }
}
```

### Core Components

1. **Indexing Service** - File watcher and document processor
2. **Search API** - FastAPI service with simple and advanced endpoints  
3. **CLI Tool** - Command-line interface for searches and management
4. **Web UI** - Lightweight observability dashboard
5. **Configuration Manager** - Project-specific settings via `.rewindex.yml` files

## Detailed Requirements

### 1. Document Indexing

#### 1.1 Index Schema

```json
{
  "mappings": {
    "properties": {
      // The Document - Just the file content
      "content": {
        "type": "text",
        "analyzer": "code_analyzer",
        "fields": {
          "keyword": {"type": "keyword", "ignore_above": 256}  // For exact matches
        }
      },
      
      // File Metadata
      "file_path": {"type": "keyword"},           // Relative to project root
      "file_name": {"type": "keyword"},           // Just the filename  
      "extension": {"type": "keyword"},           // File extension
      "language": {"type": "keyword"},            // Detected programming language
      "size_bytes": {"type": "long"},
      "line_count": {"type": "integer"},
      "last_modified": {"type": "date"},
      "indexed_at": {"type": "date"},
      
      // Versioning & Deduplication
      "content_hash": {"type": "keyword"},        // SHA-256 of content
      "previous_hash": {"type": "keyword"},       // Link to previous version
      "is_current": {"type": "boolean"},          // Latest version flag
      
      // Simple Extracted Data (via regex patterns)
      "imports": {"type": "keyword"},             // Import statements
      "exports": {"type": "keyword"},             // Exported functions/classes
      "defined_functions": {"type": "keyword"},   // Function names defined
      "defined_classes": {"type": "keyword"},     // Class names defined
      "todos": {"type": "text"},                  // TODO/FIXME/HACK comments
      "has_tests": {"type": "boolean"},           // Contains test functions
      
      // Git Integration
      "git_commit": {"type": "keyword"},
      "git_branch": {"type": "keyword"},
      "git_author": {"type": "keyword"},
      
      // Project Context
      "project_id": {"type": "keyword"},
      "project_root": {"type": "keyword"}
    }
  },
  "settings": {
    "analysis": {
      "analyzer": {
        "code_analyzer": {
          "type": "custom",
          "tokenizer": "standard",
          "char_filter": ["code_char_filter"],
          "filter": ["lowercase", "code_stop", "code_synonym"]
        }
      },
      "char_filter": {
        "code_char_filter": {
          "type": "pattern_replace",
          "pattern": "[_\\-\\.]",
          "replacement": " "
        }
      },
      "filter": {
        "code_stop": {
          "type": "stop",
          "stopwords": ["the", "and", "or", "if", "then", "else"]
        },
        "code_synonym": {
          "type": "synonym",
          "synonyms": [
            "auth,authentication,authorize",
            "config,configuration,settings",
            "db,database,datastore"
          ]
        }
      }
    }
  }
}
```

#### 1.2 File Watching Strategy

```python
class IndexingStrategy:
    """
    Real-time indexing with intelligent debouncing and batching
    """
    
    watch_events = [
        "created",
        "modified", 
        "moved",
        "deleted"
    ]
    
    debounce_ms = 500  # Wait before processing rapid changes
    batch_size = 50     # Process files in batches
    max_file_size_mb = 10  # Skip files larger than this
    
    # Performance optimizations
    parallel_workers = 4
    use_incremental_updates = True
    cache_extracted_metadata = True  # Cache regex extraction results
    
    def should_index_file(self, file_path: Path) -> bool:
        """
        Determine if file should be indexed based on patterns and size
        """
        # Check extension is in supported languages
        # Check file size is under limit
        # Check against exclude patterns
        # Return True if should index
```

#### 1.3 Ignore Patterns

Default ignore patterns (overridable via `.rewindex.yml`):
(or we could use .gitignore if it exists)

```yaml
ignore_patterns:
  - "*.min.js"
  - "*.min.css"
  - "node_modules/**"
  - "venv/**"
  - ".git/**"
  - "*.pyc"
  - "__pycache__/**"
  - "dist/**"
  - "build/**"
  - "*.lock"
  - "*.log"
  - "*.sqlite"
  - "*.db"
  - ".env*"
  - "*.key"
  - "*.pem"
  - "*.cert"
```

### 2. CLI Interface

#### 2.1 Core Commands

```bash
# Indexing Commands
rewindex index init                          # Initialize project indexing
rewindex index start [--watch]               # Start indexing (with optional watching)
rewindex index stop                          # Stop file watcher
rewindex index status                        # Show indexing status
rewindex index stats                         # Show index statistics
rewindex index rebuild [--clean]             # Rebuild index from scratch

# Search Commands (Simple)
rewindex search <query> [options]            # Basic search
  --type <code|function|class|import>     # Search specific content types
  --lang <python|js|go|...>              # Filter by language
  --path <glob>                           # Filter by file path pattern
  --ext <extension>                       # Filter by file extension
  --limit <n>                             # Number of results (default: 10)
  --context <n>                           # Lines of context (default: 2)
  --json                                   # JSON output
  --oneline                                # One line per result
  --files-only                            # Only return file paths

# Advanced Search
rewindex search-advanced <es-query-json>     # Full Elasticsearch query
rewindex search-dsl <query-dsl-file>        # Query from DSL file

# Quick Filters
rewindex find-function <name>                # Find function definitions
rewindex find-class <name>                   # Find class definitions
rewindex find-todos                          # Find all TODO/FIXME comments

# History & Versions
rewindex history <file>                      # Show file version history
rewindex diff <file> <hash1> <hash2>        # Compare versions
rewindex show <file> [--version <hash>]     # Show specific version

# Utility Commands
rewindex similar <file>                      # Find similar files
rewindex stats [--verbose]                   # Index statistics
rewindex clean [--older-than <days>]        # Clean old versions
rewindex export <output-file>                # Export index data
rewindex import <input-file>                 # Import index data
```

#### 2.2 Example Usage Patterns

```bash
# Simple searches that LLM would use
rewindex search "authentication middleware"
rewindex search "TODO" --type comment
rewindex search "import pandas" --lang python
rewindex search "useEffect" --path "src/components/**"

# Finding definitions
rewindex find-function authenticate
rewindex find-class UserService

# Quick project analysis
rewindex stats --verbose | grep "Total files"
rewindex find-todos --json | jq length

# Check what changed recently
rewindex search "*" --modified-after yesterday --files-only
```

### 3. FastAPI Service

#### 3.1 API Endpoints

```python
# Service runs on localhost:8899 by default

# Search Endpoints
POST   /search/simple              # Simplified search interface
POST   /search/advanced            # Full ES query passthrough
GET    /search/suggest?q=<term>    # Auto-complete suggestions

# File Endpoints  
GET    /file/<path>                # Get current version
GET    /file/<path>/history        # Get version history
GET    /file/<path>/version/<hash> # Get specific version

# Symbol Endpoints
GET    /symbols/<name>             # Find symbol definitions
GET    /symbols/<name>/references  # Find symbol references
GET    /symbols/tree/<path>        # Get file's symbol tree

# Index Management
POST   /index/start                # Start indexing
POST   /index/stop                 # Stop indexing
POST   /index/rebuild              # Rebuild index
GET    /index/status               # Current status
GET    /index/stats                # Statistics

# Project Management
GET    /projects                   # List all projects
POST   /projects                   # Create new project
GET    /projects/<id>              # Get project details
PUT    /projects/<id>/config       # Update project config
```

#### 3.2 Simplified Search Interface

```python
# POST /search/simple
{
    "query": "user authentication",
    "filters": {
        "language": ["python", "javascript"],
        "path_pattern": "src/**",
        "file_types": [".py", ".js"],
        "exclude_paths": ["tests/**"],
        "modified_after": "2024-01-01",
        "has_function": "authenticate",     # Check if function is defined
        "has_class": "UserService"          # Check if class is defined
    },
    "options": {
        "limit": 20,
        "context_lines": 3,
        "highlight": true,
        "include_metadata": true
    }
}

# Response
{
    "total_hits": 42,
    "search_time_ms": 23,
    "results": [
        {
            "file_path": "src/auth/middleware.py",
            "score": 0.95,
            "language": "python",
            "matches": [
                {
                    "line": 45,
                    "content": "def authenticate_user(request):",
                    "highlight": "def <mark>authenticate</mark> <mark>user</mark>(request):",
                    "context": {
                        "before": ["# Check user credentials", ""],
                        "after": ["    token = request.headers.get('Authorization')", "    if not token:"]
                    }
                }
            ],
            "metadata": {
                "size_bytes": 2048,
                "functions": ["authenticate_user", "validate_token"],
                "classes": ["AuthMiddleware"],
                "imports": ["jwt", "hashlib"]
            }
        }
    ]
}
```

#### 3.3 Advanced Search Interface

```python
# POST /search/advanced
# Direct Elasticsearch query passthrough with automatic index routing
{
    "query": {
        "bool": {
            "must": [
                {"match": {"content": "authentication"}}
            ],
            "filter": [
                {"term": {"language": "python"}},
                {"term": {"defined_functions": "authenticate"}},
                {"range": {"last_modified": {"gte": "2024-01-01"}}}
            ]
        }
    },
    "aggs": {
        "languages": {
            "terms": {"field": "language"}
        },
        "file_extensions": {
            "terms": {"field": "extension"}
        }
    },
    "highlight": {
        "fields": {
            "content": {}
        }
    }
}
```

### 4. Web UI Requirements

#### 4.1 Dashboard Pages

1. **Overview Page**
   - Index health status
   - Total files indexed
   - Last index time
   - File watcher status
   - Recent changes feed

2. **Search Interface**
   - Query builder (visual)
   - Search history
   - Saved searches
   - Result preview with syntax highlighting

3. **Index Explorer**
   - File tree view
   - Language distribution chart
   - File size distribution
   - Complexity heatmap
   - Most changed files

4. **Configuration**
   - Edit `.elastic-memory` settings
   - Manage ignore patterns
   - Index maintenance actions
   - Performance tuning

#### 4.2 Real-time Features

```javascript
// WebSocket endpoints for live updates
ws://localhost:8899/ws/indexing     // Indexing progress
ws://localhost:8899/ws/changes      // File change events
ws://localhost:8899/ws/search       // Live search results
```

### 5. Configuration File

#### 5.1 `.rewindex.yml` Schema

```yaml
version: "1.0"

project:
  id: "${auto-generated-uuid}"
  name: "my-project"
  root: "."  # Relative to config file

elasticsearch:
  host: "localhost:9200"
  index_prefix: "rewindex_${project.id}"
  
indexing:
  # File watching
  watch:
    enabled: true
    debounce_ms: 500
    batch_size: 50
  
  # File filters
  include_patterns:
    - "**/*.py"
    - "**/*.js"
    - "**/*.go"
  
  exclude_patterns:
    - "node_modules/**"
    - "venv/**"
    - "*.min.js"
    
  # Size limits
  max_file_size_mb: 10
  max_index_size_gb: 5
  
  # Simple extraction options
  extract:
    functions: true      # Extract function names with regex
    classes: true        # Extract class names with regex
    imports: true        # Extract imports with regex
    todos: true          # Extract TODO/FIXME comments
    
  # Performance
  parallel_workers: 4
  use_cache: true
  
search:
  # Default search settings
  defaults:
    limit: 20
    context_lines: 3
    highlight: true
    
  # Relevance tuning
  boost:
    file_name: 2.0       # Boost matches in filenames
    recent_files: 1.5    # Boost recently modified files
    
versioning:
  # How to handle file versions
  keep_all_versions: true
  max_versions_per_file: 50
  cleanup_after_days: 90
  
monitoring:
  # Metrics and logging
  log_level: "INFO"
  metrics_enabled: true
  metrics_port: 9090
```

### 6. Language Intelligence

#### 6.1 Language Detection

Simple extension-based detection with fallback to shebang:

```python
LANGUAGE_MAP = {
    '.py': 'python',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.ts': 'typescript', 
    '.tsx': 'typescript',
    '.go': 'go',
    '.rs': 'rust',
    '.java': 'java',
    '.cpp': 'cpp', '.cc': 'cpp', '.cxx': 'cpp',
    '.c': 'c', '.h': 'c',
    '.rb': 'ruby',
    '.php': 'php',
    '.cs': 'csharp',
    '.swift': 'swift',
    '.kt': 'kotlin',
    '.scala': 'scala',
    '.r': 'r',
    '.m': 'objc',
    '.lua': 'lua',
    '.pl': 'perl',
    '.sh': 'bash',
    '.yml': 'yaml', '.yaml': 'yaml',
    '.json': 'json',
    '.xml': 'xml',
    '.sql': 'sql',
    '.md': 'markdown'
}
```

#### 6.2 Simple Pattern Extraction

Fast regex-based extraction for common patterns:

```python
class SimpleExtractor:
    """
    Lightweight pattern extraction using regex - fast and good enough
    """
    
    def extract_metadata(self, content: str, language: str) -> Dict:
        metadata = {}
        
        if language == 'python':
            metadata['imports'] = re.findall(r'^(?:from|import)\s+(\w+)', content, re.MULTILINE)
            metadata['defined_functions'] = re.findall(r'^def\s+(\w+)', content, re.MULTILINE)
            metadata['defined_classes'] = re.findall(r'^class\s+(\w+)', content, re.MULTILINE)
            metadata['has_tests'] = bool(re.search(r'^def\s+test_', content, re.MULTILINE))
            
        elif language in ['javascript', 'typescript']:
            metadata['imports'] = re.findall(r'(?:import|require)\s*\(?["\']([^"\']+)', content)
            metadata['defined_functions'] = re.findall(r'(?:function\s+(\w+)|const\s+(\w+)\s*=.*=>)', content)
            metadata['defined_classes'] = re.findall(r'class\s+(\w+)', content)
            metadata['exports'] = re.findall(r'export\s+(?:default\s+)?(?:function|class|const)\s+(\w+)', content)
            
        elif language == 'go':
            metadata['imports'] = re.findall(r'import\s+"([^"]+)"', content)
            metadata['defined_functions'] = re.findall(r'^func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)', content, re.MULTILINE)
            metadata['defined_classes'] = re.findall(r'^type\s+(\w+)\s+struct', content, re.MULTILINE)
            
        # Universal patterns
        metadata['todos'] = re.findall(r'(?:TODO|FIXME|HACK|XXX|NOTE):\s*(.+)

### 7. Performance Requirements

#### 7.1 Benchmarks

- Initial indexing: 1000+ files/minute (with regex extraction)
- Incremental updates: < 100ms per file
- Search response: < 50ms for simple queries
- Search response: < 200ms for complex queries with filters
- File watching overhead: < 1% CPU
- Memory usage: < 300MB for service + watchers

#### 7.2 Optimization Strategies

1. **Batch Processing**: Group file changes for bulk indexing
2. **Smart Caching**: Cache regex extraction results
3. **Parallel Workers**: Process multiple files simultaneously
4. **Debouncing**: Avoid re-indexing during rapid edits
5. **Selective Indexing**: Skip binary and large files
6. **Incremental Updates**: Only re-index changed files

### 8. Security Considerations

#### 8.1 Credential Detection

Simple pattern matching to avoid indexing sensitive data:

```python
class SecurityScanner:
    """
    Detect and handle sensitive data before indexing
    """
    
    patterns = [
        r'api[_-]?key.*?=.*?["\']([^"\']+)',
        r'password.*?=.*?["\']([^"\']+)',
        r'secret.*?=.*?["\']([^"\']+)',
        r'token.*?=.*?["\']([^"\']+)',
        # AWS, GCP, Azure credential patterns
        # SSH keys, certificates
    ]
    
    def scan_file(self, content: str, file_path: str) -> Dict:
        """
        Returns scan results with recommendations
        """
        has_credentials = any(re.search(p, content, re.IGNORECASE) for p in self.patterns)
        
        if has_credentials:
            # Option 1: Skip file entirely
            # Option 2: Index with redacted content
            # Option 3: Index metadata only, skip content
            return {
                "has_sensitive_data": True,
                "recommendation": "skip_content",
                "reason": "Contains potential credentials"
            }
        
        return {"has_sensitive_data": False}
```

### 9. Deployment & Distribution

#### 9.1 Installation

```bash
# Via pip
pip install rewindex-search

# Via pipx (recommended)
pipx install rewindex-search

# Development
git clone <repo>
poetry install
poetry run rewindex index init
```

#### 9.2 Service Management

```bash
# Systemd service (Linux)
rewindex service install
systemctl start rewindex
systemctl enable rewindex

# macOS
rewindex service install --launchd
launchctl load ~/Library/LaunchAgents/rewindex.plist

# Docker
docker run -d -p 8899:8899 -v .:/project rewindex-search
```

### 10. Testing Strategy

#### 10.1 Test Coverage Requirements

- Unit tests: 80% coverage minimum
- Integration tests: All API endpoints
- Performance tests: Indexing and search benchmarks
- Language extraction tests: Regex patterns for each language
- Edge cases: Large files, binary files, symbolic links

#### 10.2 Test Data

```python
test_scenarios = [
    "Empty repository",
    "Monorepo with 10k+ files",
    "Repository with large binary files",
    "Rapid file changes",
    "Symbolic links and circular references",
    "Unicode and special characters",
    "Very long file paths",
    "Concurrent modifications",
    "Files with no extension",
    "Files with multiple extensions (.tar.gz)",
    "Files with credentials (should be handled safely)"
]
```

### 11. Future Enhancements

#### 11.1 Phase 2 Features

1. **Conversation Indexing**: Index LLM conversation history alongside code
2. **Semantic Search**: Use embeddings for meaning-based search
3. **Cross-Repository Search**: Search across multiple projects
4. **Git Blame Integration**: "Who wrote this?" queries  
5. **Smart Snippets**: Pre-compute optimal code chunks for LLM context
6. **Pattern Learning**: Learn from LLM search patterns to optimize results
7. **Project Templates**: Quick setup for common project types

#### 11.2 LLM-Specific Optimizations

1. **Context Window Management**: Smart truncation for LLM context limits
2. **Query Suggestion**: Suggest related searches based on patterns
3. **Natural Language Queries**: Convert "find the login code" to proper search
4. **Batch Operations**: Return multiple related files in one call
5. **Relevance Learning**: Adapt ranking based on which results LLMs use

#### 11.3 Potential Advanced Features (if needed)

1. **Tree-sitter Integration**: Add AST data only if regex extraction proves insufficient
2. **Type Analysis**: Basic type inference for dynamic languages
3. **Dependency Graph**: Visual representation of file relationships
4. **Code Metrics**: Complexity scores, test coverage integration

### 12. Error Handling

#### 12.1 Graceful Degradation

```python
error_strategies = {
    "elasticsearch_down": "Queue changes for later indexing",
    "file_too_large": "Index metadata only, skip content",
    "parse_error": "Fall back to text-only indexing",
    "out_of_memory": "Reduce batch size and retry",
    "disk_full": "Stop indexing, alert user",
    "corrupt_index": "Rebuild from scratch"
}
```

### 13. Monitoring & Observability

#### 13.1 Metrics to Track

```python
metrics = {
    # Indexing metrics
    "files_indexed_total": Counter,
    "indexing_errors_total": Counter,
    "indexing_duration_seconds": Histogram,
    "index_size_bytes": Gauge,
    
    # Search metrics
    "searches_total": Counter,
    "search_duration_seconds": Histogram,
    "search_results_total": Histogram,
    
    # System metrics
    "watcher_cpu_percent": Gauge,
    "memory_usage_bytes": Gauge,
    "active_watchers": Gauge
}
```

#### 13.2 Health Checks

```python
# GET /health
{
    "status": "healthy",
    "service": "rewindex",
    "version": "1.0.0",
    "elasticsearch": "connected",
    "watcher": "running",
    "index_status": "ready",
    "last_index_time": "2024-01-15T10:30:00Z",
    "files_watched": 1234,
    "errors_24h": 0
}
```

## Implementation Timeline

### Design Principles
1. **Simple is better**: File content as document, everything else as metadata
2. **Fast regex over complex parsing**: Good enough beats perfect
3. **LLM-first**: Optimize for how LLMs actually search
4. **Progressive enhancement**: Start simple, add complexity only if needed

### Phase 1: Core (Week 1-2)
- Basic indexing with file watching
- Simple CLI search
- FastAPI with simple search endpoint

### Phase 2: Intelligence (Week 3-4)
- Language parsers
- Symbol extraction
- Advanced search endpoint

### Phase 3: UI & Polish (Week 5-6)
- Web UI dashboard
- Performance optimizations
- Documentation

### Phase 4: Production (Week 7-8)
- Testing suite
- Deployment scripts
- Monitoring setup

## Success Criteria

1. **Performance**: Meet all benchmark requirements
2. **Simplicity**: LLM can use with just "rewindex search <query>"
3. **Accuracy**: 95%+ relevant results in top 10
4. **Reliability**: 99.9% uptime for local service
5. **Speed**: Sub-second indexing of file changes
6. **Maintainability**: Clean, documented, tested code with no complex dependencies

## Why This Design Works for LLMs

### Cognitive Load Minimization
- LLMs think in terms of "find code about X" not "construct complex AST query"
- Simple text search with metadata filters maps directly to how LLMs reason
- No need to understand index structures or query DSLs

### Fast Iteration
- LLM can quickly refine searches: "too broad? add --lang python"
- Results are immediately readable without transformation
- Context lines make it easy to understand matches

### Predictable Behavior
- Content field always contains exactly what's in the file
- Metadata fields are consistent across all languages
- No surprises from complex parsing or transformation

### Example LLM Interaction
```
LLM thinks: "I need to find authentication code in Python files"
LLM runs: rewindex search "authenticate" --lang python
LLM gets: Clean results with highlighted matches
LLM thinks: "I need to see the UserService class"  
LLM runs: rewindex find-class UserService
LLM gets: Direct jump to definition
```

This is exactly how an LLM wants to interact with code search - simple, fast, and predictable., content, re.MULTILINE)
        
        # Simple heuristics
        metadata['has_tests'] = metadata.get('has_tests', False) or \
                               'test' in content.lower() or \
                               'spec' in content.lower()
                               
        return metadata
```

### 7. Performance Requirements

#### 7.1 Benchmarks

- Initial indexing: 1000 files/minute minimum
- Incremental updates: < 100ms per file
- Search response: < 50ms for simple queries
- Search response: < 500ms for complex queries with aggregations
- File watching overhead: < 1% CPU
- Memory usage: < 500MB for service + watchers

#### 7.2 Optimization Strategies

1. **Batch Processing**: Group file changes
2. **Incremental Updates**: Only reindex changed parts
3. **Caching**: Cache parsed ASTs and symbols
4. **Lazy Loading**: Don't parse until needed
5. **Compression**: Compress stored content
6. **Sharding**: Split large projects across multiple indices

### 8. Security Considerations

#### 8.1 Credential Detection

```python
class SecurityScanner:
    """
    Detect and exclude sensitive data
    """
    
    patterns = [
        r'api[_-]?key.*?=.*?["\']([^"\']+)',
        r'password.*?=.*?["\']([^"\']+)',
        r'secret.*?=.*?["\']([^"\']+)',
        r'token.*?=.*?["\']([^"\']+)',
        # AWS, GCP, Azure patterns
        # SSH keys, certificates
    ]
    
    def should_exclude_file(self, content: str) -> bool:
        # Return True if file contains credentials
    
    def redact_sensitive(self, content: str) -> str:
        # Replace sensitive data with [REDACTED]
```

### 9. Deployment & Distribution

#### 9.1 Installation

```bash
# Via pip
pip install elastic-code-search

# Via pipx (recommended)
pipx install elastic-code-search

# Development
git clone <repo>
poetry install
poetry run es-index init
```

#### 9.2 Service Management

```bash
# Systemd service (Linux)
es-service install
systemctl start elastic-code-search
systemctl enable elastic-code-search

# macOS
es-service install --launchd
launchctl load ~/Library/LaunchAgents/elastic-code-search.plist

# Docker
docker run -d -p 8899:8899 -v .:/project elastic-code-search
```

### 10. Testing Strategy

#### 10.1 Test Coverage Requirements

- Unit tests: 80% coverage minimum
- Integration tests: All API endpoints
- Performance tests: Indexing and search benchmarks
- Language parser tests: Sample files for each language
- Edge cases: Large files, binary files, symbolic links

#### 10.2 Test Data

```python
test_scenarios = [
    "Empty repository",
    "Monorepo with 10k+ files",
    "Repository with large binary files",
    "Rapid file changes",
    "Symbolic links and circular references",
    "Unicode and special characters",
    "Very long file paths",
    "Concurrent modifications"
]
```

### 11. Future Enhancements

#### 11.1 Phase 2 Features

1. **Semantic Search**: Use embeddings for semantic code search
2. **Cross-Repository Search**: Search across multiple projects
3. **Conversation Indexing**: Index LLM conversation history
4. **Git Blame Integration**: "Who wrote this?" queries
5. **Dependency Graph**: Visualize file dependencies
6. **Code Metrics Dashboard**: Complexity, coverage, quality metrics
7. **Team Features**: Shared searches, annotations

#### 11.2 LLM-Specific Optimizations

1. **Context Window Management**: Smart truncation for LLM context limits
2. **Relevance Learning**: Learn from LLM's search patterns
3. **Prompt Generation**: Generate search queries from natural language
4. **Code Explanation**: Pre-index code explanations
5. **Pattern Library**: Common patterns the LLM searches for

### 12. Error Handling

#### 12.1 Graceful Degradation

```python
error_strategies = {
    "elasticsearch_down": "Queue changes for later indexing",
    "file_too_large": "Index metadata only, skip content",
    "parse_error": "Fall back to text-only indexing",
    "out_of_memory": "Reduce batch size and retry",
    "disk_full": "Stop indexing, alert user",
    "corrupt_index": "Rebuild from scratch"
}
```

### 13. Monitoring & Observability

#### 13.1 Metrics to Track

```python
metrics = {
    # Indexing metrics
    "files_indexed_total": Counter,
    "indexing_errors_total": Counter,
    "indexing_duration_seconds": Histogram,
    "index_size_bytes": Gauge,
    
    # Search metrics
    "searches_total": Counter,
    "search_duration_seconds": Histogram,
    "search_results_total": Histogram,
    
    # System metrics
    "watcher_cpu_percent": Gauge,
    "memory_usage_bytes": Gauge,
    "active_watchers": Gauge
}
```

#### 13.2 Health Checks

```python
# GET /health
{
    "status": "healthy",
    "elasticsearch": "connected",
    "watcher": "running",
    "index_status": "ready",
    "last_index_time": "2024-01-15T10:30:00Z",
    "files_watched": 1234,
    "errors_24h": 0
}
```

## Implementation Timeline

### Phase 1: Core (Week 1-2)
- Basic indexing with file watching
- Simple CLI search
- FastAPI with simple search endpoint

### Phase 2: Intelligence (Week 3-4)
- Language parsers
- Symbol extraction
- Advanced search endpoint

### Phase 3: UI & Polish (Week 5-6)
- Web UI dashboard
- Performance optimizations
- Documentation

### Phase 4: Production (Week 7-8)
- Testing suite
- Deployment scripts
- Monitoring setup

## Success Criteria

1. **Performance**: Meet all benchmark requirements
2. **Accuracy**: 95%+ relevant results in top 10
3. **Reliability**: 99.9% uptime for local service
4. **Usability**: LLM can use without documentation
5. **Maintainability**: Clean, documented, tested code
