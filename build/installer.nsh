; ReVid NSIS customisations
;
; Goal: keep "double-click opens in ReVid" for video files, but let Windows
; Explorer show the REAL video thumbnail instead of the ReVid logo.
;
; Why this is needed:
; electron-builder registers mp4/webm/mov/avi/mkv under a shared "Video" ProgId
; and forces  Software\Classes\Video\DefaultIcon = <ReVid logo>.
; A ProgId DefaultIcon overrides the per-file thumbnail in Explorer, so every
; video shows the logo. Removing that DefaultIcon (while keeping the open verb)
; restores the native thumbnail provider.
;
; The ".revid" collection format intentionally keeps its logo icon (its ProgId
; is "ReVid Collection", which we leave untouched).

!macro customInstall
  ; Drop the logo icon override on the shared video ProgId -> native thumbnails.
  DeleteRegKey SHELL_CONTEXT "Software\Classes\Video\DefaultIcon"
  ; Tell Explorer associations changed so icons refresh without a reboot.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend

!macro customUnInstall
  ; Clean up the extension -> "Video" ProgId defaults we created, so the file
  ; types cleanly fall back to the system handler after uninstall.
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.mp4" ""
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.webm" ""
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.mov" ""
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.avi" ""
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.mkv" ""
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend
