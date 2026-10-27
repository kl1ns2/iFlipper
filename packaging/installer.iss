; Inno Setup script: per-user install, so no administrator (UAC) prompt.
;   iscc packaging\installer.iss   ->  dist\iFlipper-Setup.exe
#define AppVersion GetEnv("IFLIPPER_VERSION")
#if AppVersion == ""
  #define AppVersion "0.2.0"
#endif

[Setup]
AppId={{6E1C3C8A-6B8E-4E55-9C2F-1F11A7E0F2B1}
AppName=iFlipper
AppVersion={#AppVersion}
AppPublisher=iFlipper
DefaultDirName={localappdata}\Programs\iFlipper
DefaultGroupName=iFlipper
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\dist
OutputBaseFilename=iFlipper-Setup
SetupIconFile=iflipper.ico
UninstallDisplayIcon={app}\iFlipper.exe
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "ru"; MessagesFile: "compiler:Languages\Russian.isl"
Name: "en"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "..\dist\iFlipper\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\iFlipper"; Filename: "{app}\iFlipper.exe"
Name: "{group}\{cm:UninstallProgram,iFlipper}"; Filename: "{uninstallexe}"
Name: "{userdesktop}\iFlipper"; Filename: "{app}\iFlipper.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\iFlipper.exe"; Description: "{cm:LaunchProgram,iFlipper}"; Flags: nowait postinstall skipifsilent
