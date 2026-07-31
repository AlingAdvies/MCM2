@echo off
REM ============================================================================
REM  Dagelijkse databasebackup - aangeroepen door de Windows-taak
REM  "MCM2 databasebackup". Zie docs/runbooks/supabase-verificatie-en-
REM  restoretest.md stap 0.
REM
REM  WAAROM DIT BESTAND BESTAAT, en niet een lange regel in Taakplanner:
REM  een taak die het commando rechtstreeks aanroept meldt "geslaagd" zodra
REM  cmd.exe zelf kon starten, ook als de backup daarbinnen mislukte. Dat is
REM  precies de faalvorm die het runbook waarschuwt te vermijden: je denkt
REM  beschermd te zijn terwijl er niets gebeurt. Op 2026-07-30 gebeurde dat
REM  ook echt - de taak meldde 0, er kwam geen dump.
REM
REM  Dit script logt altijd: start, einde en uitkomst.
REM
REM  LET OP: dit bestand moet in ANSI/ASCII staan, niet UTF-8. cmd.exe leest
REM  UTF-8 met BOM verkeerd en voert dan elke regel als los commando uit.
REM  Daarom staan er geen accenten of speciale tekens in dit bestand.
REM ============================================================================

setlocal

REM Tweede locatie: OneDrive synchroniseert naar de cloud, zodat de dump niet
REM alleen op deze machine staat (ADR-011, risico-acceptatie Free Plan).
set "BACKUP_DIR=C:\Users\cmali\OneDrive - Aling Advies\MCM2-backups"
set "LOG=%BACKUP_DIR%\backup-taak.log"
set "PROJECT=C:\DEV\Work\MCM2"
set "NODE=C:\Program Files\nodejs\node.exe"

if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%"

echo. >> "%LOG%"
echo ===== %DATE% %TIME% - start >> "%LOG%"

cd /d "%PROJECT%"
if errorlevel 1 (
    echo FOUT: projectmap niet bereikbaar. >> "%LOG%"
    exit /b 1
)

"%NODE%" scripts\backup-dump.js >> "%LOG%" 2>&1
set UITKOMST=%ERRORLEVEL%

if "%UITKOMST%"=="0" (
    echo ===== %DATE% %TIME% - GESLAAGD >> "%LOG%"
) else (
    echo ===== %DATE% %TIME% - MISLUKT, code %UITKOMST% >> "%LOG%"
)

exit /b %UITKOMST%