# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

<<<<<<< Updated upstream
=======
## [0.6.4] - 2026-01-11
### Changed
- **BBMM Buttons:**
  - Changed "BBMM" buttons on settings and module management windows to display a drop-down menu instead of opening a separate window. 
### Fixed
- **Inclusions/Exclusions:**
  - Fixed bug in inclusions/exclusions migration to persistent storage where when opening a new world, or world that has not migrated could overwrite inclusions/exclusions.

## [0.6.3] - 2026-01-05
### Fixed
- **Journal:**
  - Uploaded image for journal for preset migration instructions. 

## [0.6.2] - 2026-01-05
### Changed
- **Changelog:** 
  - Updated version tag in changelog to reflect the version that it was updated from. Example: "1.0.0 -> 1.2.3". Thanks [ChasarooniZ](https://github.com/ChasarooniZ/)!
- **Journal:**
  - Fixed broken image link in journal for preset migration instructions. 
- **Localization:**
  - Updated Italian localization. Credit: [GregoryWarn](https://github.com/thejoester/bbmm/issues?q=is%3Apr+is%3Aopen+author%3AGregoryWarn)!

>>>>>>> Stashed changes
## [0.6.1] - 2026-01-02
### Added
- **Setting Sync:**
  - Added setting to force player reload when setting sync happens with setting that requires reload instead of prompting them. Default is disabled.
  - Added Hidden Setting Sync manager to allow manual adding of hidden client settings that may be on menus.
### Fixed
- **Inclusions/Exclusions:**
 - Fixed issue with saved inclusions / exclusions not migrating to the global persistent storage. 

## [0.6.0] - 2025-12-31
### Changed
- **Presets:**
  - GM Setting presets and Module presets are now saved in persistent storage, and will be shared across worlds.
    - See instructions in Compendium Journal on how to import your old presets! 
### Changed
- **Inclusions/Exclusions:**
  - Inclusion/Exclusion lists are now stored in persistent storage, and accessible from all worlds. 
  - Should migrate when loading a world for the first time. 
  - Filtered out '[menu]’ settings to clean up lists. 
  - When adding a setting inclusion/exclusion, will filter by module in drop down. 
  - Reminder: Please read the [Wiki](https://github.com/thejoester/bbmm/wiki) or compendium journal regarding inclusions/exclusions and hidden settings!
- **Settings-Sync:**
  - Added optional setting to force reload for players when setting requiring reload is locked/synced. 
- **Changelog:**
  - Moved "Mark Current Seen" and "Mark All Seen" buttons so they remain static even if window resizes. 

## [0.5.17] - 2025-12-06
### Changed
- **Localization:**
  - [#71](https://github.com/thejoester/bbmm/issues/71): Updated Italian (it) localization. Thank you [GregoryWarn](https://github.com/GregoryWarn)!
### Fixed
- **Changelog Report:**
  - Fixed bug causing inline text to be unreadable in light mode.

## [0.5.16] - 2025-12-04
### Changed
- **Changelog Report:**
  - [#66](https://github.com/thejoester/bbmm/issues/66): When marking changelog entry as seen, will move to next unread entry.
### Fixed
- **Module Management:**
  - [#69](https://github.com/thejoester/bbmm/issues/69) (nice): Fixed CSS style for "All Modules" button so it shows properly in light and dark modes.

## [0.5.15] - 2025-11-19
### Changed
- **Localization:**
  - Updated French (fr) localization. Thank you [Rectulo](https://gitlocalize.com/users/rectulo)!

## [0.5.14] - 2025-11-03
### Fixed
- **Module Management:**
  - Fixed bug where `Manage Modules` button did not open the enhanced module management window when other core language was set. 

## [0.5.13] - 2025-11-02
### Fixed
- **Localization:** 
  - Added Polish language to module.json. 

## [0.5.12] - 2025-10-31 
### Added
- **Localization:** 
  - Added Polish (pl) localization. Thank you [Lioheart](https://gitlocalize.com/users/Lioheart)!

## [0.5.11] - 2025-10-31
### Changed
- **Module Management:**
  - Added "Clear" in filter field. 
  - When disabling a module, if there are dependencies or orphaned dependencies it will allow to decide which modules if any to disable. 
- **Localization:** 
- Updated French (fr) localization. Thank you [Rectulo](https://gitlocalize.com/users/rectulo)!

## [0.5.10] - 2025-10-29
### Fixed
- **Module Management:** Fixed setting so that enhanced module management does not open if disabled in settings.  

## [0.5.9] - 2025-10-29
### Changed
- **Module Management:** Complete overhaul of the Module Management window. 
  - Improved performance! Rebuilt as a separate ApplicationV2 window. 
  - Header shows enabled/disabled module counts.
  - Added Activate All modules option.
  - Added Lock icon that will lock module state from being changed. 
  - Shows count of Dependencies and Conflicts from module.json for each module when expanded.
  - Smart Dependency & Safety Logic:
    - Enabling modules:
      - Prompts if the module requires dependencies not yet enabled.
      - Immediately marks those deps active in the temp config & UI.
      - Prompts to select recommended modules allowing to select/unselect individual modules. 
    - Disabling modules:
      - Detects and lists dependent modules that rely on the one being disabled, prompts to disable them too.
      - Detects orphaned requires (modules now unused by anything else), offers to disable those as well for a clean load order.
  - Find The Culprit! Support.

## [0.5.8] - 2025-10-13
### Changed
- **Localization:**
  - Updated Italian (it) localization. Thank you [GregoryWarn](https://github.com/GregoryWarn)!

## [0.5.7] - 2025-10-11
### Changed
- **Module Management:**
  - [Issue #48](https://github.com/thejoester/bbmm/issues/48): If there are no notes for a module, it will show the module description from the module.json if it exists when expanded. 
- **Macros:**
  - Consolidated macros into module code so they could be localized. 
  - Added macro to reset changelog seen state and reopen changelog report. 
### Fixed 
- **Changelog Report:**
  - [Issue #47](https://github.com/thejoester/bbmm/issues/47): Fixed issue with some changelog text pushing off window, and forcing buttons off window. 
- **Macros:**
  - (Multiple) copy button in macros now functional to copy value to clipboard. 

## [0.5.6] - 2025-10-09
### Changed
- **Controls Sync:**
  - When applying soft-sync icon changes to orange
  - added right-click gesture to clear soft-sync
- **Inclusion/Exclusion Managers:**
  - When adding inclusions/exclusions, window will not close allowing to add multiple settings/modules. 
  - Changed buttons on exclusion manager window to match inclusion manager. 

## [0.5.5] - 2025-10-07
### Changed
- **Inclusion Manager:**
  - updated warning text when including module: fixed link so it works and localized the text.
- **Macros (Compendium):** 
  - Updated the `BBMM: Game Settings Inspector` macro to allow to browse user flags for current user and all users. 
  - Note: This module currently does not support user flags at this time, it may be something that will be supported later but this macro may help locate where something is saved.

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