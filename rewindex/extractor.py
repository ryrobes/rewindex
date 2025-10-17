from __future__ import annotations

import re
from typing import Dict, List


class SimpleExtractor:
    """
    Lightweight regex-based metadata extraction.
    Covers Python, JS/TS, and Go as common cases. Falls back to universal patterns.
    """

    TODO_PATTERN = re.compile(r"(?i)\b(?:TODO|FIXME|HACK)\b[\s:.-]*(.*)")

    def extract_metadata(self, content: str, language: str) -> Dict:
        metadata: Dict[str, List[str] | bool] = {}

        if language == "python":
            metadata["imports"] = re.findall(r"^(?:from|import)\s+([\w\.]+)", content, re.MULTILINE)
            metadata["defined_functions"] = re.findall(r"^def\s+(\w+)", content, re.MULTILINE)
            metadata["defined_classes"] = re.findall(r"^class\s+(\w+)", content, re.MULTILINE)
            metadata["has_tests"] = bool(re.search(r"^def\s+test_", content, re.MULTILINE))

        elif language in ("javascript", "typescript"):
            metadata["imports"] = re.findall(r"(?:import|require)\s*\(?[\"\']([^\"\']+)", content)
            funcs = re.findall(r"(?:function\s+(\w+)|const\s+(\w+)\s*=.*=>)", content)
            metadata["defined_functions"] = [x for t in funcs for x in t if x]
            metadata["defined_classes"] = re.findall(r"class\s+(\w+)", content)
            metadata["exports"] = re.findall(r"export\s+(?:default\s+)?(?:function|class|const)\s+(\w+)", content)

        elif language == "go":
            metadata["imports"] = re.findall(r"import\s+\"([^\"]+)\"", content)
            metadata["defined_functions"] = re.findall(r"^func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)", content, re.MULTILINE)
            metadata["defined_classes"] = re.findall(r"^type\s+(\w+)\s+struct", content, re.MULTILINE)

        todos = []
        for m in self.TODO_PATTERN.finditer(content):
            item = m.group(1).strip() if m.group(1) else ""
            if item:
                todos.append(item)
        if todos:
            metadata["todos"] = todos

        txt = content.lower()
        has_tests_flag = bool(metadata.get("has_tests")) or ("test" in txt or "spec" in txt)
        metadata["has_tests"] = bool(has_tests_flag)

        return metadata

