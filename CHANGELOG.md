# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres

## [0.1.5] - 2025-08-31
### Added
- **BBMM:** added minimal v12 support. In v12 just added tools to export settings and module states to .json to prep for migration to v13.
    - NOTE! Cannot guarantee all settings will import in v13 if setting names have changed. 

## [0.1.4] - 2025-08-30
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
