from __future__ import annotations

import json
import ssl
from dataclasses import dataclass
from typing import Any, Dict, Optional
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urljoin, urlparse
from urllib.request import Request, urlopen


def _normalize_base(host: str) -> str:
    if host.startswith("http://") or host.startswith("https://"):
        base = host
    else:
        base = f"http://{host}"
    # ensure trailing slash
    if not base.endswith('/'):
        base += '/'
    return base


def _json_request(method: str, url: str, body: Optional[dict] = None, timeout: int = 30) -> Dict[str, Any]:
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
    req = Request(url, method=method, data=data)
    req.add_header("Content-Type", "application/json")

    # accept self-signed if https (dev)
    context = None
    if url.startswith("https://"):
        context = ssl.create_default_context()
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
    try:
        with urlopen(req, timeout=timeout, context=context) as resp:
            raw = resp.read()
            if not raw:
                return {}
            return json.loads(raw.decode("utf-8"))
    except HTTPError as e:
        # return parsed body when possible for diagnostics
        try:
            raw = e.read().decode("utf-8")
            return {"error": e.code, "body": json.loads(raw)}
        except Exception:
            raise
    except URLError:
        raise


@dataclass
class ESInfo:
    base: str


class ESClient:
    def __init__(self, host: str) -> None:
        self.base = _normalize_base(host)

    def _url(self, path: str) -> str:
        return urljoin(self.base, path)

    # Index management
    def index_exists(self, index: str) -> bool:
        url = self._url(index)
        req = Request(url, method="HEAD")
        try:
            with urlopen(req, timeout=10) as resp:
                return 200 <= resp.status < 400
        except HTTPError as e:
            if e.code == 404:
                return False
            raise

    def create_index(self, index: str, body: dict) -> dict:
        return _json_request("PUT", self._url(index), body)

    def delete_index(self, index: str) -> dict:
        return _json_request("DELETE", self._url(index))

    def refresh(self, index: str) -> dict:
        return _json_request("POST", self._url(f"{index}/_refresh"))

    def count(self, index: str) -> int:
        res = _json_request("GET", self._url(f"{index}/_count"))
        return int(res.get("count", 0))

    # Documents
    def get_doc(self, index: str, doc_id: str) -> Optional[dict]:
        url = self._url(f"{index}/_doc/{quote(doc_id, safe='')}")
        try:
            res = _json_request("GET", url)
            if res.get("found"):
                return res
            return None
        except HTTPError as e:
            if e.code == 404:
                return None
            raise

    def put_doc(self, index: str, doc_id: str, body: dict) -> dict:
        url = self._url(f"{index}/_doc/{quote(doc_id, safe='')}")
        return _json_request("PUT", url, body)

    def post_doc(self, index: str, body: dict) -> dict:
        url = self._url(f"{index}/_doc")
        return _json_request("POST", url, body)

    def search(self, index: str, body: dict) -> dict:
        return _json_request("POST", self._url(f"{index}/_search"), body)

    # Bulk API (optional)
    def bulk(self, ndjson: str) -> dict:
        req = Request(self._url("_bulk"), method="POST", data=ndjson.encode("utf-8"))
        req.add_header("Content-Type", "application/x-ndjson")
        with urlopen(req, timeout=60) as resp:
            raw = resp.read()
            return json.loads(raw.decode("utf-8"))


def ensure_indices(es: ESClient, index_prefix: str) -> dict:
    from .es_schema import FILES_INDEX_BODY, VERSIONS_INDEX_BODY

    files_index = f"{index_prefix}_files"
    versions_index = f"{index_prefix}_versions"
    created = {}
    if not es.index_exists(files_index):
        created[files_index] = es.create_index(files_index, FILES_INDEX_BODY)
    if not es.index_exists(versions_index):
        created[versions_index] = es.create_index(versions_index, VERSIONS_INDEX_BODY)
    return {"files_index": files_index, "versions_index": versions_index, "created": created}

