"""Run with `python3 -m vibedash_modules` from the modules folder (localhost only by default)."""

from .app import serve
from .config import load_modules, modules_dir

srv = serve()
m = load_modules()
print(
    f"vibedash-modules on {srv.server_address[0]}:{srv.server_address[1]} · folder {modules_dir()} · "
    f"modules: {', '.join(sorted(m['modules'])) or 'none'}" + (f" · errors: {m['errors']}" if m["errors"] else ""),
    flush=True,
)
srv.serve_forever()
