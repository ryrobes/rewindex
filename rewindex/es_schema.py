FILES_INDEX_BODY = {
    "settings": {
        "analysis": {
            "analyzer": {
                "code_index_analyzer": {
                    "type": "custom",
                    "tokenizer": "standard",
                    "filter": ["lowercase", "word_parts", "code_stop"],
                },
                "code_search_analyzer": {
                    "type": "custom",
                    "tokenizer": "standard",
                    "filter": ["lowercase", "word_parts", "code_stop"],
                },
            },
            "filter": {
                "word_parts": {
                    "type": "word_delimiter_graph",
                    "generate_word_parts": True,
                    "generate_number_parts": True,
                    "split_on_numerics": True,
                    "split_on_case_change": True,
                    "preserve_original": True,
                    "catenate_words": False,
                    "catenate_numbers": False,
                    "catenate_all": False,
                    "stem_english_possessive": False
                },
                "code_stop": {
                    "type": "stop",
                    "stopwords": ["the", "and", "or", "if", "then", "else"],
                },
            },
        }
    },
    "mappings": {
        "properties": {
            "content": {
                "type": "text",
                "analyzer": "code_index_analyzer",
                "search_analyzer": "code_search_analyzer",
                "term_vector": "with_positions_offsets",
                "fields": {"keyword": {"type": "keyword", "ignore_above": 256}},
            },
            "file_path": {"type": "keyword"},
            "file_name": {"type": "keyword", "fields": {"text": {"type": "text", "analyzer": "code_index_analyzer", "search_analyzer": "code_search_analyzer"}}},
            "extension": {"type": "keyword"},
            "language": {"type": "keyword"},
            "size_bytes": {"type": "long"},
            "line_count": {"type": "integer"},
            "last_modified": {"type": "date"},
            "indexed_at": {"type": "date"},
            "content_hash": {"type": "keyword"},
            "previous_hash": {"type": "keyword"},
            "is_current": {"type": "boolean"},
            "imports": {"type": "keyword"},
            "exports": {"type": "keyword"},
            "defined_functions": {"type": "keyword"},
            "defined_classes": {"type": "keyword"},
            "todos": {"type": "text"},
            "has_tests": {"type": "boolean"},
            "git_commit": {"type": "keyword"},
            "git_branch": {"type": "keyword"},
            "git_author": {"type": "keyword"},
            "project_id": {"type": "keyword"},
            "project_root": {"type": "keyword"},
        }
    },
}


VERSIONS_INDEX_BODY = {
    "settings": FILES_INDEX_BODY["settings"],
    "mappings": {
        "properties": {
            "file_path": {"type": "keyword"},
            "content_hash": {"type": "keyword"},
            "previous_hash": {"type": "keyword"},
            "created_at": {"type": "date"},
            "is_current": {"type": "boolean"},
            "content": {
                "type": "text",
                "analyzer": "code_index_analyzer",
                "search_analyzer": "code_search_analyzer",
                "term_vector": "with_positions_offsets",
            },
            "language": {"type": "keyword"},
            "project_id": {"type": "keyword"},
        }
    },
}

