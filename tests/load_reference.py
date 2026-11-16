"""Load TRACETONE.txt (TraceTone v.16, Pythonista) as a module with the iOS-only modules stubbed."""
import importlib.machinery
import importlib.util
import os
import sys
import types

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(ROOT, 'TRACETONE.txt')


def load():
    ui = types.ModuleType('ui')
    ui.View = object
    sys.modules.setdefault('ui', ui)
    for name in ('sound', 'console', 'dialogs', 'clipboard'):
        sys.modules.setdefault(name, types.ModuleType(name))
    loader = importlib.machinery.SourceFileLoader('tracetone_v16', SOURCE)
    spec = importlib.util.spec_from_loader('tracetone_v16', loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod
