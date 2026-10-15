@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
if defined COMFY_PYTHON (
  "%COMFY_PYTHON%" -c "import sys;sys.exit(0 if sys.version_info >= (3,10) else 1)" >nul 2>nul
  if not errorlevel 1 (
    "%COMFY_PYTHON%" "%~dp0runner.py" %*
    if errorlevel 1 pause
    exit /b
  )
)
py -3 -c "import sys;sys.exit(0 if sys.version_info >= (3,10) else 1)" >nul 2>nul
if not errorlevel 1 (
  py -3 "%~dp0runner.py" %*
  if errorlevel 1 pause
  exit /b
)
python -c "import sys;sys.exit(0 if sys.version_info >= (3,10) else 1)" >nul 2>nul
if not errorlevel 1 (
  python "%~dp0runner.py" %*
  if errorlevel 1 pause
  exit /b
)
echo 未找到可用的 Python 3.10+，可直接使用 ComfyUI 便携包中的 Python：
echo   "X:\ComfyUI_windows_portable\python_embeded\python.exe" "%~dp0runner.py"
echo 或将 COMFY_PYTHON 环境变量设为该 python.exe 完整路径，再运行本文件。
echo 程序没有下载或安装任何内容。
pause
exit /b 1
