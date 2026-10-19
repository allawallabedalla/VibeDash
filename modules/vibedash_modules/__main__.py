"""Run with `python3 -m vibedash_modules` from the modules folder (localhost only by default)."""

import threading

from .app import serve, ticker
from .config import load_modules, modules_dir

srv = serve()
m = load_modules()
print(
    f"vibedash-modules on {srv.server_address[0]}:{srv.server_address[1]} · folder {modules_dir()} · "
    f"modules: {', '.join(sorted(m['modules'])) or 'none'}" + (f" · errors: {m['errors']}" if m["errors"] else ""),
    flush=True,
)
# modules with a period (e.g. the car's account every 15 min) run in their own thread
threading.Thread(target=ticker, args=(modules_dir(), threading.Event()), daemon=True, name="ticker").start()
srv.serve_forever()
