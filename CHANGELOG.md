# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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