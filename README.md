# Big Bad Module Manager

A module management tool for FoundryVTT. 

This module was originally inspired by [Module Management+](https://github.com/mouse0270/module-credits/).

> [!NOTE]
> Please [report any issues or feature requests here](https://github.com/thejoester/bbmm/issues)!

<br/>
<a href='https://ko-fi.com/thejoester/tip' target='_blank'><img height='36' style='border:0px;height:36px;' src='https://storage.ko-fi.com/cdn/kofi6.png?v=6' border='0' alt='Buy Me a Coffee at ko-fi.com' /></a>

### For documentation please see [the Wiki](https://github.com/thejoester/bbmm/wiki)

## Features
### Enhanced Module Management
- Redesigned Module List: compact card-style layout replaces Foundry's default module list for faster scanning
- Module Tags: create custom tags and subtags, assign them to modules for organized grouping and filtering
- Module Notes: attach rich-text notes to individual modules; falls back to the module's own description if no note exists
- Quick Settings Access: per-module button that opens the Settings menu directly to that module's tab
- Lock Module state: lock module so state (enabled/disabled) will not be affected by Activate/Deactivate all modules.

<img width="60%" height="60%" alt="image" src="https://github.com/thejoester/bbmm/blob/main/docs/img/enhanced-module-management.webp" />

### New Module Detection
- Detects when new module(s) has been installed and prompts to enable. 
 <img width="50%" height="50%" alt="image" src="https://github.com/thejoester/bbmm/blob/main/docs/img/new-module-detection.webp?raw=true" />

### Changelog report
- Opens report on login for GM with latest change logs for modules that contain a changelog file.
<img width="70%" height="70%" alt="image" src="https://github.com/thejoester/bbmm/blob/main/docs/img/changelog-report.webp?raw=true" />

### BBMM Toolbox
Most of BBMM's tools now live in one window, with a tab list down the left side:
Module Presets, Settings Presets, Lock Presets, Inclusions / Exclusions, Settings Locks, Tag Manager, and Import / Export, plus a GM-only Utilities tab and a Read Me tab. Open it from the **BBMM** button in the Module Management / settings header. Players only see the tools that apply to them.

### Module Presets
- Save module state (enabled/disabled) as a preset.
- Load / update / delete preset.

<img width="70%" height="70%" alt="image" src="https://github.com/thejoester/bbmm/blob/main/docs/img/module-presets1.webp?raw=true" />
<br>
<img width="40%" height="40%" alt="image" src="https://github.com/thejoester/bbmm/blob/main/docs/img/module-presets2.webp?raw=true" />

### Settings Presets
- GMs manage shared world presets; players get their own personal presets that only affect their own settings.
- Save settings state as a preset.
- Load / update / delete preset.
- Choose which modules or specific settings to import.
<img width="70%" height="70%" alt="image" src="https://github.com/thejoester/bbmm/blob/main/docs/img/settings-presets1.webp?raw=true" />

### Setting Locks & Sync
- User/client-scope settings each get a Lock and a Sync icon in the settings window.
  - **Lock:** opens a dialog to Hard Lock (players can't change it) or Soft Lock (pushes a recommended value players can still change) to a value you choose.
  - **Sync:** pushes your value to connected players.
- **Lock Manager (Settings Locks tab):** browse and manage every active lock in one place; add locks (including hidden settings), edit a lock's value/type, or remove it.
- **Lock Presets:** save a set of locks as a preset and apply it in any world.
- **Controls (keybind) Sync:** sync or soft-lock keybindings to chosen players.
<img width="40%" height="40%" alt="image" src="https://github.com/thejoester/bbmm/blob/main/docs/img/setting-lock1.webp?raw=true" />
<img width="40%" height="40%" alt="image" src="https://github.com/thejoester/bbmm/blob/main/docs/img/setting-lock2.webp?raw=true" />
<img width="60%" height="60%" alt="image" src="https://github.com/thejoester/bbmm/blob/main/docs/img/setting-lock3.webp?raw=true" />

### Include & Exclude modules & settings (Advanced feature)
- Include: Add hidden settings to include on presets, imports, and exports. 
- Exclude: Add settings and modules to ignore on presets, imports, and exports.
<img width="60%" height="60%" alt="image" src="https://github.com/thejoester/bbmm/blob/main/docs/img/inclusions-exclusions1.webp?raw=true" />

### Import / Export
  - Export and import module presets, settings presets, inclusion/exclusion lists, module tags, and your keybindings as .json.
<img width="60%" height="60%" alt="image" src="https://github.com/thejoester/bbmm/blob/main/docs/img/import-export.webp?raw=true" />

## Credits
I would like to extend a thanks to the following people for helping contribute to this module!

### Translations
- French (fr): [Rectulo](https://gitlocalize.com/users/rectulo)
- Italian (it): [GregoryWarn](https://github.com/thejoester/bbmm/issues?q=is%3Apr+author%3AGregoryWarn)
- Polish (pl): [Lioheart](https://gitlocalize.com/users/Lioheart)
- Brazilian Portuguese (pt-BR): [FarenRavirar](https://github.com/FarenRavirar) / [Kharmans](https://github.com/Kharmans)!

### Testing
- Many thanks to [RedB-hub](https://github.com/RedB-hub) for testing my module thoroughly!

## Contribute

If you would like to contribute to the localization, you can do so in one of these ways: 

#### Translate through [Gitlocalize](https://gitlocalize.com/repo/10409). 

#### Fork and Submit a Pull Request:
1. [Fork the repository](https://www.youtube.com/watch?v=f5grYMXbAV0) (copy main branch only).
2. Then download or copy the [en.json](https://github.com/thejoester/bbmm/blob/master/lang/en.json) file.
3. Rename it to the proper [language code](https://en.wikipedia.org/wiki/List_of_ISO_639_language_codes) (for example es.json for Spanish language),
4. Edit the file translating the text in quotes on the RIGHT SIDE of the colon.
5. When done upload the new language file to your fork in the **lang/** folder,
6. Click the "Contribute" button and "Open Pull Request".

#### Upload file as Issue:
1. Download the [en.json](https://github.com/thejoester/bbmm/blob/master/lang/en.json) file,
2. Rename it to the Open up an [Issue](https://github.com/thejoester/bbmm/issues) and attach the file. 
