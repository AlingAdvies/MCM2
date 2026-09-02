@echo off
REM ============================================================================
REM  Uurlijkse controle - aangeroepen door de Windows-taak
REM  "MCM2 tenant-uitnodigingscontrole".
REM
REM  Zelfde wrapper-vorm als backup-controle-taak.cmd: vast node-pad, logging
REM  naar bestand, cd naar de projectmap voor het script draait.
REM
REM  LET OP: dit bestand moet in ANSI/ASCII staan, niet UTF-8. cmd.exe leest
REM  UTF-8 met BOM verkeerd en voert dan elke regel als los commando uit.
REM  Daarom staan er geen accenten of speciale tekens in dit bestand.
REM ============================================================================

setlocal

set "LOG=%USERPROFILE%\.mcm2-uitnodigingscontrole\taak.log"
set "PROJECT=C:\DEV\Work\MCM2"
set "NODE=C:\Program Files\nodejs\node.exe"

if not exist "%USERPROFILE%\.mcm2-uitnodigingscontrole" mkdir "%USERPROFILE%\.mcm2-uitnodigingscontrole"

echo. >> "%LOG%"
echo ===== %DATE% %TIME% - start >> "%LOG%"

cd /d "%PROJECT%"
if errorlevel 1 (
    echo FOUT: projectmap niet bereikbaar. >> "%LOG%"
    exit /b 1
)

"%NODE%" scripts\uitnodiging-controle.js >> "%LOG%" 2>&1
set UITKOMST=%ERRORLEVEL%

if "%UITKOMST%"=="0" (
    echo ===== %DATE% %TIME% - OK >> "%LOG%"
) else (
    echo ===== %DATE% %TIME% - FOUT, code %UITKOMST% >> "%LOG%"
)

exit /b 0
