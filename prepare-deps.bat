@echo off
REM ===================================================================
REM Prepare Dependencies Script
REM Copies all required DLLs for Electron portable build
REM ===================================================================

echo.
echo ===================================
echo Preparing Dependencies for Electron
echo ===================================
echo.

REM Create deps directory if it doesn't exist
if not exist "deps" (
    echo Creating deps directory...
    mkdir deps
)

REM ===================================================================
REM OPENCV DLLs
REM ===================================================================
echo.
echo [1/3] Copying OpenCV DLLs...
echo ------------------------------

set OPENCV_PATH=C:\opencv\build\x64\vc16\bin

if exist "%OPENCV_PATH%" (
    echo Found OpenCV at: %OPENCV_PATH%
    
    REM Copy OpenCV DLLs
    if exist "%OPENCV_PATH%\opencv_world4100.dll" (
        copy /Y "%OPENCV_PATH%\opencv_world4100.dll" "deps\" >nul
        echo   - Copied opencv_world4100.dll
    ) else (
        echo   ! Warning: opencv_world4100.dll not found
    )
    
    if exist "%OPENCV_PATH%\opencv_world4100d.dll" (
        copy /Y "%OPENCV_PATH%\opencv_world4100d.dll" "deps\" >nul
        echo   - Copied opencv_world4100d.dll
    ) else (
        echo   ! Warning: opencv_world4100d.dll not found
    )
) else (
    echo ! ERROR: OpenCV not found at %OPENCV_PATH%
    echo ! Please install OpenCV or update the path in this script
)

REM ===================================================================
REM HDF5 DLLs (from vcpkg)
REM ===================================================================
echo.
echo [2/3] Copying HDF5 DLLs...
echo ------------------------------

set VCPKG_PATH=C:\vcpkg\installed\x64-windows\bin

if exist "%VCPKG_PATH%" (
    echo Found vcpkg libraries at: %VCPKG_PATH%
    
    REM Copy HDF5 DLL
    if exist "%VCPKG_PATH%\hdf5.dll" (
        copy /Y "%VCPKG_PATH%\hdf5.dll" "deps\" >nul
        echo   - Copied hdf5.dll
    ) else (
        echo   ! Warning: hdf5.dll not found
    )
    
    REM Copy zlib DLL
    if exist "%VCPKG_PATH%\zlib1.dll" (
        copy /Y "%VCPKG_PATH%\zlib1.dll" "deps\" >nul
        echo   - Copied zlib1.dll
    ) else if exist "%VCPKG_PATH%\zlib.dll" (
        copy /Y "%VCPKG_PATH%\zlib.dll" "deps\" >nul
        echo   - Copied zlib.dll
    ) else (
        echo   ! Warning: zlib.dll not found
    )
    
    REM Copy AEC DLL (compression library for HDF5)
    if exist "%VCPKG_PATH%\aec.dll" (
        copy /Y "%VCPKG_PATH%\aec.dll" "deps\" >nul
        echo   - Copied aec.dll
    ) else (
        echo   ! Warning: aec.dll not found (HDF5 compression may not work)
    )
    
    REM Copy szip DLL if exists (alternative compression)
    if exist "%VCPKG_PATH%\szip.dll" (
        copy /Y "%VCPKG_PATH%\szip.dll" "deps\" >nul
        echo   - Copied szip.dll
    )
    
) else (
    echo ! ERROR: vcpkg not found at %VCPKG_PATH%
    echo ! Please install vcpkg and HDF5 or update the path in this script
)

REM Try multiple possible locations for VC++ runtime
set VC_RUNTIME_FOUND=0

REM Option 1: System32 (usually installed with Visual Studio or VC++ Redistributables)
if exist "C:\Windows\System32\vcruntime140.dll" (
    echo Found VC++ Runtime in System32
    copy /Y "C:\Windows\System32\vcruntime140.dll" "deps\" >nul
    copy /Y "C:\Windows\System32\vcruntime140_1.dll" "deps\" >nul 2>nul
    copy /Y "C:\Windows\System32\msvcp140.dll" "deps\" >nul
    echo   - Copied VC++ Runtime DLLs from System32
    set VC_RUNTIME_FOUND=1
)

REM Option 2: Visual Studio installation
if %VC_RUNTIME_FOUND%==0 (
    set "VS_RUNTIME=C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Redist\MSVC\14.38.33130\x64\Microsoft.VC143.CRT"
    if exist "%VS_RUNTIME%\vcruntime140.dll" (
        echo Found VC++ Runtime in Visual Studio
        copy /Y "%VS_RUNTIME%\vcruntime140.dll" "deps\" >nul
        copy /Y "%VS_RUNTIME%\vcruntime140_1.dll" "deps\" >nul 2>nul
        copy /Y "%VS_RUNTIME%\msvcp140.dll" "deps\" >nul
        echo   - Copied VC++ Runtime DLLs from Visual Studio
        set VC_RUNTIME_FOUND=1
    )
)

REM Option 3: Check Program Files for VC++ Redistributables
if %VC_RUNTIME_FOUND%==0 (
    set "VC_REDIST=C:\Program Files (x86)\Microsoft Visual Studio\2019\Community\VC\Redist\MSVC\14.29.30133\x64\Microsoft.VC142.CRT"
    if exist "%VC_REDIST%\vcruntime140.dll" (
        echo Found VC++ Runtime in Redistributables
        copy /Y "%VC_REDIST%\*.dll" "deps\" >nul
        echo   - Copied VC++ Runtime DLLs from Redistributables
        set VC_RUNTIME_FOUND=1
    )
)

if %VC_RUNTIME_FOUND%==0 (
    echo   ! Warning: VC++ Runtime DLLs not found
    echo   ! The application may not run on systems without Visual C++ Redistributables
)

REM ===================================================================
REM Copy thermal data files
REM ===================================================================
echo.
echo [Bonus] Copying thermal data files...
echo ------------------------------

if exist "backend\native\thermal\data\temp_mapping.csv" (
    copy /Y "backend\native\thermal\data\temp_mapping.csv" "deps\" >nul
    echo   - Copied temp_mapping.csv
)

if exist "backend\native\thermal\data\Color_IMG_px.png" (
    copy /Y "backend\native\thermal\data\Color_IMG_px.png" "deps\" >nul
    echo   - Copied Color_IMG_px.png
)

REM ===================================================================
REM Summary
REM ===================================================================
echo.
echo ===================================
echo Dependency Preparation Complete!
echo ===================================
echo.

REM List all files in deps directory
echo Files in deps directory:
echo ------------------------
dir /B deps\*.dll 2>nul
dir /B deps\*.csv 2>nul
dir /B deps\*.png 2>nul

echo.
echo Total files copied:
for /f %%A in ('dir /a-d-s-h /b "deps" 2^>nul ^| find /c /v ""') do echo   %%A files

echo.
echo Done! You can now run "npm run build-portable"
echo.

pause