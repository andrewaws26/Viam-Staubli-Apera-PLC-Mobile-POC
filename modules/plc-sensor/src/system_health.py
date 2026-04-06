"""Re-export from shared module for backward compatibility."""
import importlib.util as _ilu
import os as _os

_common_path = _os.path.join(
    _os.path.dirname(__file__), '..', '..', 'common', 'system_health.py'
)
_spec = _ilu.spec_from_file_location('_common_system_health', _common_path)
_mod = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(_mod)

get_system_health = _mod.get_system_health
