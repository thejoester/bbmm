# Big Bad Module Manager

A module management tool for FoundryVTT. 

This module was originally inspired by [Module Management+](https://github.com/mouse0270/module-credits/).

> [!NOTE]
> Please [report any issues or feature requests here](https://github.com/thejoester/bbmm/issues)!

<br/>
<a href='https://ko-fi.com/thejoester/tip' target='_blank'><img height='36' style='border:0px;height:36px;' src='https://storage.ko-fi.com/cdn/kofi6.png?v=6' border='0' alt='Buy Me a Coffee at ko-fi.com' /></a>

### For documentation please see [the Wiki](https://github.com/thejoester/bbmm/wiki)

## Features
### Advanced Module Management
- Redesigned Module List: compact card-style layout replaces Foundry's default module list for faster scanning
- Module Tags: create custom tags and subtags, assign them to modules for organized grouping and filtering
- Module Notes: attach rich-text notes to individual modules; falls back to the module's own description if no note exists
- Quick Settings Access: per-module button that opens the Settings menu directly to that module's tab
- Lock Module state: lock module so state (enabled/disabled) will not be affected by Activate/Deactivate all modules. 
<img width="60%" height="60%" alt="image" src="https://github.com/user-attachments/assets/7f8ba8d2-b0f1-470b-a1fb-6f4cb6911a69" />

### Module Presets
- Save module state (enabled/disabled) as a preset.
- Load / update / delete preset.
- Export module state to .json.
- import .json to preset.

<img width="50%" height="50%" alt="image" src="https://github.com/user-attachments/assets/115ae28b-fcab-4ff8-8538-a2d49e0ce2b6" />
<br>
<img width="50%" height="50%" alt="image" src="https://github.com/user-attachments/assets/9b3c2e6f-85a6-4b7c-9664-48b288a1868d" />

### Settings Presets
- Save settings state as a preset.
- Load / update / delete preset.
- Export settings state to .json
- import .json to preset:
- Choose which modules or specific settings to import.
<img width="50%" height="50%" alt="image" src="https://github.com/user-attachments/assets/c16735dc-fa68-4d1b-ac8f-4ff7ce7415d0" />

### Settings/Controls Sync
- For user/client scope settings will have a Lock and a sync icon
  - Lock (toggle): will force player setting to match GM, and hide from player settings.
  - Sync: Will push GM setting to currently connected player(s).
- Controls (keybinds) Sync
<img width="50%" height="50%" alt="image" src="https://github.com/user-attachments/assets/28a1c8a5-12df-440c-b125-bdc940e65ca1" />

### Include & Exclude modules & settings (Advanced feature)
- Include: Add hidden settings to include on presets, imports, and exports. 
- Exclude: Add settings and modules to ignore on presets, imports, and exports.
<img width="50%" height="50%" alt="image" src="https://github.com/user-attachments/assets/cab6f371-f382-49bd-a8b3-205714e60dde" />

### Changelog report
- Opens report on login for GM with latest change logs for modules that contain a changelog file.
<img width="70%" height="70%" alt="image" src="https://github.com/user-attachments/assets/4ff3761e-aa80-42c2-9729-f6d4479d5747" />

### New Module Detection
- Detects when new module(s) has been installed and prompts to enable. 
 <img width="50%" height="50%" alt="image" src="https://github.com/user-attachments/assets/8441b303-0746-4c73-b820-38d9a90a46ad" />

## Credits
I would like to extend a thanks to the following people for helping contribute to this module!

### Translations
- French (fr): [Retculo](https://gitlocalize.com/users/rectulo)
- Italian (it): [GregoryWarn](https://github.com/thejoester/bbmm/issues?q=is%3Apr+author%3AGregoryWarn)
- Polish (pl): [Lioheart](https://gitlocalize.com/users/Lioheart)
- Brazilian Portuguese (pt-BR): [FarenRavirar](https://github.com/FarenRavirar) / [Kharmans](https://github.com/Kharmans)!

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
