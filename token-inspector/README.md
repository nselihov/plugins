# Token Inspector (Figma dev-плагин)

Смотреть, какие компоненты используют переменную Figma (и наоборот) — прямо из Figma.
Работает с любым типом переменных: цвет, spacing, radius, sizing, типографика, opacity, visible.

## Установка
1. Figma **Desktop** → меню **Plugins → Development → Import plugin from manifest…**
2. Выбрать `token-inspector/manifest.json` из этого репозитория.
3. Запуск: **Plugins → Development → Token Inspector**.

## Режимы
- **Токен → компоненты:** выбрать переменную → «Скан» → список компонентов + счётчики + разбивка по типу привязки (fill/stroke/text/icon/gap/padding/radius/size/font-size/…). Клик по строке = выделить и приблизить компонент на холсте.
- **Компонент → токены:** выделить компонент/инстанс → «Скан выделения» → какие переменные использует.
- **Мёртвые токены:** кнопка внизу — переменные с 0 консумеров на всех страницах файла.

## Примечания
- «Токен → компоненты» считает по мастер-компонентам (COMPONENT_SET / верхнеуровневые COMPONENT), инстансы наследуют и не спускаются внутрь (иначе ячейки матриц вариантов вешают Figma на больших файлах).
- Скан по всем страницам грузит их все (`loadAsync` по очереди) — на большом файле может занять пару секунд.
- Только чтение, ничего в файле не меняет.

## English

Figma dev plugin: find which components use a given variable (and vice versa) — right inside Figma.
Works with any variable type: color, spacing, radius, sizing, typography, opacity, visible.

**Install:** Figma Desktop → Plugins → Development → Import plugin from manifest… → pick `token-inspector/manifest.json`. Updating the plugin is just `git pull` — Figma reads the files fresh on next launch.

**Modes:** Token → Components (pick a variable, see which master components use it, broken down by binding kind); Component → Tokens (select a layer, see which variables it uses); Dead Tokens (variables with zero consumers across the file).

Read-only — never modifies the file.
