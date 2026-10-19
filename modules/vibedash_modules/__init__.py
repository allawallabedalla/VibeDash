"""VibeDash modules: tools that make whole pages (boards) – maintenance plan first, more to come.

Each module lives in its own package with a Module class (name, board(), action(), feeds, feed()). The service
(app.py) loads the modules that have a config file in the modules folder (MODULES_DIR, default local/modules):
local/modules/<name>.json. No config = module off. House contents (plan, notes) live only in that folder.
"""

KNOWN = ("wartung", "raeume")
