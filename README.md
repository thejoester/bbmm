# Big Bad Module Manager

A module management tool for FoundryVTT. 

This module was inspired by [Module Management+](https://github.com/mouse0270/module-credits/), which has not been updated since v9 and finally broke in v13. This module aims to replicate those features for v13.

> [!NOTE]
> Please [report any issues or feature requests here](https://github.com/thejoester/bbmm/issues)!

<br/><br/>
<a href='https://ko-fi.com/X8X817QMZQ' target='_blank'><img height='36' style='border:0px;height:36px;' src='https://storage.ko-fi.com/cdn/kofi6.png?v=6' border='0' alt='Buy Me a Coffee at ko-fi.com' /></a>

## Features
### Module Presets
- Save module state (enabled/disabled) as a preset.
- Load / update / delete preset.
- Export module state to .json.
- import .json to preset.

### Settings Presets
- Save settings state as a preset.
- Load / update / delete preset.
- Export settings state to .json
- import .json to preset:
  - Choose which modules or specific settings to import.

### Settings Sync
- For user/client scope settings will have a Lock and a sync icon, 
  - Lock (toggle):
    - Click = Lock Selected (will promtp to select users).
    - Right-Click = Lock All.
    - Shift+Click = Soft Lock.
    - Shift+Right-Click = Clear Locks.
  - Soft Lock option, will sync user setting once, but allow them to change it unless GM changes setting while soft lock enabled. 
  - Sync: Will push GM setting to currently connected player(s). 

### Controls (Key Binds) Sync
- Allows GM to sync keybinds
  - Click: prompts to select online users to sync key bindings with.
    - Players need to be connected.
  - Shift+Click: Soft-Lock sync. Will change users setting but still allow them to change it.
    - Players do not need to be connected.

### Exclude or Incluide modules & settings
- Add specific setting / modules to ignore on presets/imports/exports.
- Inclusion manager to include hidden settings / modules in presets/inports/exports.

### Changelog report
- Opens report on login for GM with latest change logs for modules that contain a changelog file.
  
## Roadmap
These are some features I hope to add to this module in upcoming updates:

### Customize Module List
- Add tags to modules
  - Sort/group by tags 
  - Add personal notes to modules
- Settings links on module list to module setting


## Screenshots
<img width="60%" height="60%" alt="image" src="https://github.com/user-attachments/assets/fe5a02f3-dce4-4b0b-8ed1-bd64311ddf72" />
<br /><br />
<img width=40% height=40% alt="image" src="https://github.com/user-attachments/assets/c16735dc-fa68-4d1b-ac8f-4ff7ce7415d0" />
<br /><br />
<img width="40%" height="40%" alt="image" src="https://github.com/user-attachments/assets/115ae28b-fcab-4ff8-8538-a2d49e0ce2b6" />
<br /><br />
<img width="40%" height="40%" alt="image" src="https://github.com/user-attachments/assets/9b3c2e6f-85a6-4b7c-9664-48b288a1868d" />
<br /><br />
<img width="40%" height="40%" alt="image" src="https://github.com/user-attachments/assets/cb33e3e1-fe8b-42d7-9b7c-4a990c47d8e5" />
<br /><br />
<img width="520" height="169" alt="image" src="https://github.com/user-attachments/assets/28a1c8a5-12df-440c-b125-bdc940e65ca1" />
<br /><br />
<img width="70%" height="70%" alt="image" src="https://github.com/user-attachments/assets/4ff3761e-aa80-42c2-9729-f6d4479d5747" />


## Credits
I would like to extend a thanks to the following people for helping contribute to this module!

### Translations
- French (fr): Retculo
- Italian (it): [GregoryWarn](https://github.com/thejoester/bbmm/issues?q=is%3Apr+author%3AGregoryWarn)

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