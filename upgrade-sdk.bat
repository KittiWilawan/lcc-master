@echo off
cd /d D:\lcc-master
call npx expo install expo@latest --fix > D:\lcc-master\upgrade-log.txt 2>&1
echo DONE >> D:\lcc-master\upgrade-log.txt
