# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.6-test.3] - 2025-10-09
### Changed
- **Inclusion/Exclusion Managers:**
  - Changed buttons on exclusion manager window to match inclusion manager. 

## [0.5.6-test.2] - 2025-10-09
- **Inclusion/Exclusion Managers:**
  - When adding inclusions/exclusions, window will not close allowing to add multiple settings/modules. 

## [0.5.6-test.1] - 2025-10-08
### Added
- **Controls Sync:**
  - When applying soft-sync icon changes to orange
  - added right-click gesture to clear soft-sync

## [0.5.5] - 2025-10-07
### Changed
- **Inclusion Manager:**
  - updated warning text when including module: fixed link so it works and localized the text.
- **Macros (Compendium):** 
  - Updated the `BBMM: Game Settings Inspector` macro to allow to browse user flags for current user and all users. 
    - This module currently does not support user flags at this time, it may be something that will be supported later but this macro may help locate where something is saved.

## [0.5.4] - 2025-10-06
### Changed
- **Localization:**
  - Updated Italian (it) localization. Thank you [GregoryWarn](https://github.com/GregoryWarn)!
  - Updated French (fr) localization. Thank you [Rectulo](https://gitlocalize.com/users/rectulo)!

## [0.5.3] - 2025-10-02
### Added
- **Module Management:**
  - Added gear icon in module list for modules with settings option, clicking will open settings to module settings tab. 

## [0.5.2] - 2025-09-30
### Fixed
- **Module Management:**
  - Fixed bug where enabling/disabling module with dependencies did not show the module or dependency changed. 

## [0.5.1] - 2025-09-28
### Changed
- **Localization:**
  - Updated Italian (it) localization. Thank you [GregoryWarn](https://github.com/GregoryWarn)!
  - Updated French (fr) localization. Thank you [Rectulo](https://gitlocalize.com/users/rectulo)!
### Fixed
- **Module Management:**
  - fixed bug where "deactivate all modules" button was not functioning. 
- **Module:**
  - suppressed false positive console errors about missing localization keys before localization was finished loading. 

## [0.5.0] - 2025-09-22
### Added 
- **Module Management:**
  - Added enhanced module management
    - Enable/Disable in settings (default: enabled).
    - Added edit button, add notes to module. 
    - If notes exist, when clicking on module in list will expand to show notes. 
- **Controls Sync:**
  - (these were added in 0.4.0 but was not included in notes)
  - Lets a GM sync key binding settings to players. 
  - Click: Sync to connected players.
  - Shift+Click: Will put a "Soft-Lock" on the sync.
### Fixed
- **Inclusion Manager:** 
  - Fixed bug not showing some settings. 
- **Settings Sync:**
  - Fixed bug when setting soft lock, users not logged in would not sync. 
  - Fixed bug where lock/sync icons not showing for some user/client scoped settings.   
  - Fixed bug when locking settings when no users setup it did not save
  - Can now export/import sync and lock states
- **Changelog Report:**
  - fixed depriciation warning for `FilePicker` and `TextEditor`.
### Changed
- **Documentation:**
  - Updated Journal Documentation

## [0.4.1] - 2025-09-17
### Fixed
- included assets/ folder for images in journal. 

## [0.4.0] - 2025-09-17
### Added
- **Compendiums:**
  - Added Compendium folder "Big Bad Module Manager".
  - Added Journal for module with documentation.
  - Added Macro compendium:
    - Macro to show changelog report manually. 
    - Macro to Inspect settings. 
    - Macro to Inspect Setting Presets.
- **Inclusion Manager:**
  - Added inclusion manager to include hidden settings in presets/inports/exports.
### Changed
- **Settings Sync:**
  - Added click gesture detection on the lock icon:
    - Click = Lock Selected (will promtp to select users).
    - Right-Click = Lock All.
    - Shift+Click = Soft Lock.
    - Shift+Right-Click = Clear Locks. 
  - Soft Lock option, will sync user setting once, but allow them to change it unless GM changes setting while soft lock enabled. 
  - Icon changes immediately, but changes still only save when clicking "Save Changes" 
  - Settings will allow to change click gesture behavior. 
- **Settings Preset Manager:**
  - No longer save hidden settings as it could cause issues with many hidden settings. 
    - See Inclusion Manager to add specific hidden settings you wish to save. 
    - Use with Caution! See [Wiki](https://github.com/thejoester/bbmm/wiki) or Journal documentation!
### Fixed
- **Settings Sync:**
  - When GM changes setting with lock (hard or soft), it will clear lock. 

## [0.3.3] - 2025-09-09
### Added
- **Localization:** Added Italian (it) localization. Credit: [GregoryWarn](https://github.com/thejoester/bbmm/issues?q=is%3Apr+author%3AGregoryWarn)
### Fixed
- **Changelog Report:** Fixed markdown formatting. 
### Changed
- **Settings:** Changed default debug level to none.

## [0.3.2] - 2025-09-07
### Fixed
- **Settings Sync**
  - Fixed typo affecting hover text and missing entry in en.json
  
## [0.3.1] - 2025-09-03
### Changed
- **Settings Sync**
  - Added settings lock toggle, this will lock setting value for players and hide setting from them. 
  - Sync icon is no longer toggle, pushing it will push current GM setting to connected players but will not lock the setting. 
  - Added setting option to enable/disable settings sync feature. 
- **Changelog report**
  - Updated styling and interaction settings of changelog window.

## [0.3.0] - 2025-09-03
### Added
- **Settings Sync**
  - Added Sync icon next to user/client settings. 
  - When clicked it toggles on and turns orange. 
  - Will push setting to connected clients, but also when clients log in they sync to enabled GM settings.
### Fixed
- **Changelog report** 
  - Fixed issues for lower resolution displays:
    - Moved 'Mark Seen' buttons to top
    - Window will resize to smaller size if resolution is smaller

## [0.2.2] - 2025-09-02
### Changed
- **Changelog report** 
  - Locked changelog window to fixed width
  - Improved url detection, links now show properly
### Fixed
- **Changelog report** 
  - Fixed style of changelog on light interface settings.

## [0.2.1] - 2025-09-01
### Fixed
- **Settings Preset Manager:** fixed bug preventing import of settings .json file

## [0.2.0] - 2025-08-31
### Added
- **Changelog report** Upon GM login will show report of changelogs. 
  - Will only show if module includes changelog file in the root or 'docs/' directory
  - Can mark/unmark as read
  - enabled by default, can disable in settings
  - default only shows enabled modules, can change in settings to show all modules
- **Settings Preset Manager:** Added "Preview" button to preview changes loading a preset will make, will highlight changes in red. 
  - This may hang for a minute if lots of changes or large data included. 
- **v12:** added minimal v12 support. In v12 just added tools to export settings and module states to .json to prep for migration to v13.
    - NOTE! Cannot guarantee all settings will import in v13 if setting names have changed. 
### Fixed
- **Module Preset Manager:** Fixed dual 'export to .json' buttons.

## [0.1.3] - 2025-08-30
### Added
- **Localization:** Added French translation. Credit: @retculo

## [0.1.2] - 2025-08-29
### Fixed
- **Localization:** fixed issue with en.json not being included in install. 

## [0.1.1] - 2025-08-28
### Added
- Added Localization support. 

## [0.1.0] - 2025-08-25
### Added
- **Exclusions:** Added exclusions manager allowing to add exclusions for settings presets/import/export. Supports adding by entire module or direct setting. 
- **Player Support:** Settings Preset Manager accessible for users through Settings or View Active Modules screens. 
- **Macro:** Added Settings Preset inspector macro that will show saved setting values in selected preset. 
- **Presets (modules and settings):** Added update button that will overwrite the selected preset with current settings / module list. 
### Changed
- Moved button on Manage Modules window to toolbar
- Added button on Settings window toolbar
### Fixed
- **Settings Preset Manager:** export/import suppord for user scope settings. This is only for current user.
- **Settings Preset Manager:** fixed bug that overwrote module state when loading setting presets. 

## [0.0.7] - 2025-08-25
### Fixed 
- **Settings Preset Manager:** Fixed bug with loading preset with recent changes. 

## [0.0.6] - 2025-08-24
### Added
- **Settings Preset Manager:** When importing, you can now choose to import all settings, or specify which module, or specific setting. 
### Fixed
- **Settings Preset Manager:** Fixed bug preventing certain data types being saved (for example the new Reach Enforcement setting for pf2e system). 
- **Settings Preset Manager:** Excluding saving settings of presets for this module (BBMM), resulting in presets being overwriten as well as dramatically increasing file size of .json. Should be MUCH smaller now. 
- **Macros:** Added macro to inspect preset and view values (click values to expand if needed).

## [0.0.5] - 2025-08-21
### Fixed
- **Settings Preset Manager:** Fixed bug not saving settings on a separate template page. 
- **Settings Preset Manager:** Blocking importing preset settings to prevent them being overwritten when importing, and siginificantly reducing the size of export. 
### Added
- **Settings Preset Manager:** 	
## [0.0.4] - 2025-08-21
### Added
- **Settings Preset Manager:**
  - Save / Delete / Load presets,
  - Export settings state to .json.
  - Import .json to preset.
### Changed
- **BBMM:** Changed "Preset Manager" button to "BBMM" on manage modules window, opens window to choose Module or Settings preset manager

## [0.0.3] - 2025-08-21
### Added
- **Module Preset Manager:** Added "Preset Manager" button to manage modules window.
- **Module Preset Manager:** Added overwrite protection for presets. 
  - If you try and save/import a preset with an existing name, it will prompt overwrite/rename.

## [0.0.2] - 2025-08-20
### Changed
- Added manifest and github links to module.json.

## [0.0.1] - 2025-08-20
### Added
- **Initial Upload:** Initial upload.
- **Module Preset Manager:**
  - Save / Delete / Load presets,
  - Export module state to .json.
  - Import .json to preset.
