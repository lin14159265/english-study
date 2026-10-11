@echo off
setlocal
cd /d "%~dp0.."
node scripts\prepare-reader-v2-preview.cjs
if errorlevel 1 goto done
call npx firebase-tools@13.35.1 hosting:channel:deploy v2-reader --expires 7d --project wowlin-english-study --config .reader-v2-preview\firebase.json
:done
pause
