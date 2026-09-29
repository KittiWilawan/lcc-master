import argparse
import hashlib
import json
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import requests


def read_arguments():
    parser = argparse.ArgumentParser(description="Download and verify a public Figshare file")
    parser.add_argument("article_id", type=int)
    parser.add_argument("file_id", type=int)
    parser.add_argument("output", type=Path)
    return parser.parse_args()


def find_file(article, file_id):
    for item in article["files"]:
        if item["id"] == file_id:
            return item
    raise ValueError(f"File {file_id} is not part of article {article['id']}")


def unsigned_url(signed_url):
    parts = urlsplit(signed_url)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))


def md5_for(path):
    digest = hashlib.md5()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(16 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def request_download_location(session, download_url):
    response = session.get(download_url, allow_redirects=False, timeout=30)
    response.raise_for_status()
    location = response.headers.get("Location")
    if not location:
        raise RuntimeError("Figshare did not return a download location")
    return location


def main():
    args = read_arguments()
    session = requests.Session()
    session.headers["User-Agent"] = "LCC thesis dataset downloader/1.0"
    article_url = f"https://api.figshare.com/v2/articles/{args.article_id}"
    article_response = session.get(article_url, timeout=30)
    article_response.raise_for_status()
    article = article_response.json()
    selected_file = find_file(article, args.file_id)

    first_location = request_download_location(session, selected_file["download_url"])
    session.head(unsigned_url(first_location), timeout=30)
    fresh_location = request_download_location(session, selected_file["download_url"])

    args.output.parent.mkdir(parents=True, exist_ok=True)
    existing_size = args.output.stat().st_size if args.output.exists() else 0
    headers = {"Range": f"bytes={existing_size}-"} if existing_size else {}
    response = session.get(fresh_location, headers=headers, stream=True, timeout=(30, 120))
    response.raise_for_status()
    append = existing_size > 0 and response.status_code == 206
    mode = "ab" if append else "wb"
    with args.output.open(mode) as destination:
        for chunk in response.iter_content(chunk_size=16 * 1024 * 1024):
            if chunk:
                destination.write(chunk)

    actual_size = args.output.stat().st_size
    if actual_size != selected_file["size"]:
        raise RuntimeError(f"Size mismatch: {actual_size} != {selected_file['size']}")
    actual_md5 = md5_for(args.output)
    if actual_md5 != selected_file["computed_md5"]:
        raise RuntimeError(f"MD5 mismatch: {actual_md5} != {selected_file['computed_md5']}")
    print(json.dumps({
        "article": article["title"],
        "license": article["license"]["name"],
        "file": str(args.output),
        "bytes": actual_size,
        "md5": actual_md5,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
