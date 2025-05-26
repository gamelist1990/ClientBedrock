; Simple installer script for Skin Injector
; Sets custom installation directory

!macro preInit
  ; Set default installation directory
  StrCpy $INSTDIR "C:\Program Files\PEXtool\skinInjector"
!macroend

!macro customInit
  ; Ensure the installation directory is set correctly
  StrCpy $INSTDIR "C:\Program Files\PEXtool\skinInjector"
!macroend

!macro customInstall
  ; Custom installation steps can be added here if needed
!macroend

!macro customUninstall
  ; Custom uninstallation steps can be added here if needed
!macroend

; Required section for NSIS
Section "MainSection" SEC01
  ; This section is required but electron-builder handles the actual installation
SectionEnd
