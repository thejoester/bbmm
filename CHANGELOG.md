# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.5] - 2025-08-21
### Fixed
- **Settings Preset Manager:** Fixed bug not saving settings on a separate template page. 

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