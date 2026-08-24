import os
import sys

import webview


def resource_path(relative_path: str) -> str:
    """Resolve a path both when run as a plain script and when frozen by PyInstaller."""
    base_path = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base_path, relative_path)


def main() -> None:
    html_path = resource_path("index.html")
    webview.create_window(
        "Development Build Launcher",
        html_path,
        width=480,
        height=900,
        resizable=True,
    )
    webview.start()


if __name__ == "__main__":
    main()
