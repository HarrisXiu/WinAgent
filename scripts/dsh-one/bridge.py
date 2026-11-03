"""One request on stdin -> one JSON response on stdout; no desktop/UI runtime."""
import contextlib
import importlib.metadata
import json
import os
import sys
import tempfile
from pathlib import Path


def dispatch(request):
    from desktop_service import ConversionService
    from office_backend import PROGIDS
    import winreg

    if request.get('action') == 'inspect':
        engines = {}
        for provider, kinds in PROGIDS.items():
            engines[provider] = {}
            for kind, ids in kinds.items():
                available = []
                for progid in ids:
                    try:
                        with winreg.OpenKey(winreg.HKEY_CLASSES_ROOT, progid):
                            available.append(progid)
                    except OSError:
                        pass
                engines[provider][kind] = available
        result = {'python': sys.executable, 'engines': engines,
                  'dependencies': {name: importlib.metadata.version(name) for name in
                                   ('pywin32', 'pypdf', 'Pillow', 'reportlab', 'pypdfium2')}}
        if request.get('path'):
            source = Path(request['path']).resolve(strict=True)
            if source.suffix.lower() not in ('.xls', '.xlsx', '.xlsm'):
                raise ValueError('工作表检查只接受 Excel 文件')
            with tempfile.TemporaryDirectory(prefix='dsh-office2pdf-') as data:
                service = ConversionService(data)
                service.config.engine = request.get('engine', 'auto')
                result['sheets'] = service.get_excel_sheets(str(source))
                result['logs'] = list(service.logs)
        return result

    if request.get('action') != 'convert':
        raise ValueError('未知操作')
    items = request.get('files')
    if not isinstance(items, list) or not items:
        raise ValueError('files 必须是非空数组')
    output = request.get('output_dir')
    if not isinstance(output, str) or not output.strip() or not os.path.isabs(output):
        raise ValueError('必须指定输出目录绝对路径')
    options = request.get('options') or {}
    # UI/process settings are owned by the bridge, never accept auto_open.
    allowed = {'engine', 'naming_tpl', 'blank_page_action', 'wm1_text', 'wm1_pos', 'wm2_text', 'wm2_pos',
               'wm_font', 'wm_size', 'wm_color', 'wm_alpha', 'pg_enabled', 'pg_pos', 'pg_format',
               'password', 'merge_all', 'split_word_page', 'split_ppt_page', 'split_pdf_page',
               'split_excel_sheet', 'split_excel_page', 'excel_fit', 'excel_fit_tall',
               'compress_pdf', 'clear_metadata'}
    if not isinstance(options, dict) or set(options) - allowed:
        raise ValueError('存在未知或不支持的转换选项')
    paths = []
    for item in items:
        if not isinstance(item, dict) or not isinstance(item.get('path'), str) or not os.path.isabs(item['path']):
            raise ValueError('每个输入必须提供文件绝对路径')
        source = Path(item['path']).resolve(strict=True)
        if not source.is_file() or source.suffix.lower() not in (
                '.doc', '.docx', '.xls', '.xlsx', '.xlsm', '.ppt', '.pptx', '.pdf', '.png', '.jpg', '.jpeg'):
            raise ValueError(f'不支持的输入文件：{source}')
        normalized = os.path.normcase(str(source))
        if normalized in paths:
            raise ValueError(f'重复输入文件：{source}')
        paths.append(normalized)

    class CapturingService(ConversionService):
        def finalize_pdfs(self, paths, dest, *args, **kwargs):
            super().finalize_pdfs(paths, dest, *args, **kwargs)
            self.outputs.append(dest)

    with tempfile.TemporaryDirectory(prefix='dsh-office2pdf-') as data:
        service = CapturingService(data)
        service.outputs = []
        cfg = service._config({**options, 'output_dir': str(Path(output).resolve()), 'out_mode': 'custom',
                               'auto_open': False, 'open_folder': False, 'clear_after': False})
        service.config = cfg
        service.add([str(Path(item['path']).resolve()) for item in items])
        for row, item in zip(service.files, items):
            service.set_range(row['path'], item.get('range', ''))
        service.processing = True
        service.main_process(cfg, service.files)
        snapshot = service.snapshot()
        return {'ok': all(row['status'] == 'success' for row in snapshot['files']),
                'files': [{key: row[key] for key in ('path', 'type', 'status')} for row in snapshot['files']],
                'outputs': service.outputs, 'logs': snapshot['logs'], 'engine': snapshot['actual_engine']}


if __name__ == '__main__':
    try:
        request = json.load(sys.stdin)
        # Keep diagnostic prints from dependencies out of the JSON protocol.
        with contextlib.redirect_stdout(sys.stderr):
            response = dispatch(request)
        print(json.dumps(response, ensure_ascii=False))
    except Exception as exc:
        print(f'{type(exc).__name__}: {exc}\n请为本插件配置 pythonPath，并安装 python/requirements.txt 中的依赖。', file=sys.stderr)
        sys.exit(1)
