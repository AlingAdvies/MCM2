@echo off
REM ============================================================================
REM  Dagelijkse backupCONTROLE - aangeroepen door de Windows-taak
REM  "MCM2 backupcontrole". Draait NA de backup zelf.
REM
REM  WAAROM DIT LOS STAAT VAN backup-taak.cmd:
REM  als de backup helemaal niet draait - laptop uit, taak uitgeschakeld,
REM  Docker weg - dan waarschuwt de backup zelf ook niet. Dat gebeurde op
REM  1 t/m 3 augustus 2026: vier dagen geen backup, geen enkel signaal.
REM  De controle moet dus onafhankelijk draaien van wat hij controleert.
REM
REM  Zelfde gedachte als de serverbewaking in de Saxo-app: "draait los van de
REM  app, want als de app crasht moet de melding juist nog werken".
REM
REM  De wekelijkse variant (--volledig) doet er een echte herstelproef bij.
REM
REM  LET OP: dit bestand moet in ANSI/ASCII staan, niet UTF-8. cmd.exe leest
REM  UTF-8 met BOM verkeerd en voert dan elke regel als los commando uit.
REM  Daarom staan er geen accenten of speciale tekens in dit bestand.
REM ============================================================================

setlocal

set "BACKUP_DIR=C:\Users\cmali\OneDrive - Aling Advies\MCM2-backups"
set "LOG=%BACKUP_DIR%\backup-controle.log"
set "PROJECT=C:\DEV\Work\MCM2"
set "NODE=C:\Program Files\nodejs\node.exe"

REM Eerste argument doorgeven: leeg = dagelijks, --volledig = wekelijks.
set "MODUS=%~1"

if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%"

echo. >> "%LOG%"
echo ===== %DATE% %TIME% - start %MODUS% >> "%LOG%"

cd /d "%PROJECT%"
if errorlevel 1 (
    echo FOUT: projectmap niet bereikbaar. >> "%LOG%"
    exit /b 1
)

"%NODE%" scripts\backup-controle.js %MODUS% >> "%LOG%" 2>&1
set UITKOMST=%ERRORLEVEL%

REM Exitcode 1 betekent hier "probleem gevonden en gemeld", niet "script stuk".
REM Dat is een geldige uitkomst van een controle: de Telegram-melding is al
REM verstuurd. In het log blijft het verschil zichtbaar.
if "%UITKOMST%"=="0" (
    echo ===== %DATE% %TIME% - GEEN PROBLEMEN >> "%LOG%"
) else (
    echo ===== %DATE% %TIME% - PROBLEEM GEMELD, code %UITKOMST% >> "%LOG%"
)

exit /b 0
