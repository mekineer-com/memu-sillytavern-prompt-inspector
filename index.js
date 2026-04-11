import { eventSource, event_types, main_api, stopGeneration } from '../../../../script.js';
import { renderExtensionTemplateAsync } from '../../../extensions.js';
import { POPUP_RESULT, POPUP_TYPE, Popup } from '../../../popup.js';
import { t } from '../../../i18n.js';

const path = 'third-party/prompt-inspector';

if (!('GENERATE_AFTER_COMBINE_PROMPTS' in event_types) || !('CHAT_COMPLETION_PROMPT_READY' in event_types)) {
    toastr.error('Required event types not found. Update SillyTavern to the latest version.');
    throw new Error('Events not found.');
}

function isChatCompletion() {
    return main_api === 'openai';
}

function addLaunchButton() {
    const enabledText = t`Stop Inspecting`;
    const disabledText = t`Inspect Prompts`;
    const enabledIcon = 'fa-solid fa-bug-slash';
    const disabledIcon = 'fa-solid fa-bug';

    const getIcon = () => inspectEnabled ? enabledIcon : disabledIcon;
    const getText = () => inspectEnabled ? enabledText : disabledText;

    const launchButton = document.createElement('div');
    launchButton.id = 'inspectNextPromptButton';
    launchButton.classList.add('list-group-item', 'flex-container', 'flexGap5', 'interactable');
    launchButton.tabIndex = 0;
    launchButton.title = t`Toggle prompt inspection`;
    const icon = document.createElement('i');
    icon.className = getIcon();
    launchButton.appendChild(icon);
    const textSpan = document.createElement('span');
    textSpan.textContent = getText();
    launchButton.appendChild(textSpan);

    const extensionsMenu = document.getElementById('prompt_inspector_wand_container') ?? document.getElementById('extensionsMenu');
    if (!extensionsMenu) {
        throw new Error('Could not find the extensions menu');
    }
    extensionsMenu.classList.add('interactable');
    extensionsMenu.tabIndex = 0;

    extensionsMenu.appendChild(launchButton);
    launchButton.addEventListener('click', () => {
        toggleInspectNext();
        textSpan.textContent = getText();
        icon.className = getIcon();
    });
}

let inspectEnabled = localStorage.getItem('promptInspectorEnabled') === 'true' || false;
let generationCancelled = false;

function consumeGenerationCancelled() {
    if (!generationCancelled) return false;
    generationCancelled = false;
    return true;
}

function toggleInspectNext() {
    inspectEnabled = !inspectEnabled;
    toastr.info(`Prompt inspection is now ${inspectEnabled ? 'enabled' : 'disabled'}`);
    localStorage.setItem('promptInspectorEnabled', String(inspectEnabled));
}

function makeInfo(text, style = '') {
    const d = document.createElement('div');
    d.style.cssText = style;
    d.textContent = text;
    return d;
}

function makeFormattedMessage(msg) {
    const wrapper = document.createElement('div');
    wrapper.className = 'pi-message';
    const roleDiv = document.createElement('div');
    roleDiv.className = 'pi-role';
    roleDiv.textContent = String(msg.role || 'unknown');
    const pre = document.createElement('pre');
    pre.className = 'pi-content';
    pre.textContent = String(msg.content || '');
    wrapper.appendChild(roleDiv);
    wrapper.appendChild(pre);
    return wrapper;
}

function contentText(raw) {
    if (typeof raw === 'string') return raw.trim();
    if (Array.isArray(raw)) {
        return raw
            .map((part) => {
                if (typeof part === 'string') return part;
                if (part && typeof part === 'object' && typeof part.text === 'string') return part.text;
                return '';
            })
            .filter(Boolean)
            .join('\n')
            .trim();
    }
    if (raw && typeof raw === 'object' && typeof raw.text === 'string') return raw.text.trim();
    return '';
}

function lastUserTextFromContext() {
    const ctx = globalThis.SillyTavern?.getContext?.();
    const chat = Array.isArray(ctx?.chat) ? ctx.chat : [];
    const userName = String(ctx?.name1 || '');
    for (let i = chat.length - 1; i >= 0; i--) {
        const row = chat[i];
        const isUser = row?.is_user === true || (userName && String(row?.name || '') === userName);
        if (!isUser) continue;
        const text = typeof row?.mes === 'string' ? row.mes.trim() : '';
        if (text) return text;
    }
    return '';
}

function withSyntheticLastUser(chat) {
    if (!Array.isArray(chat)) return chat;
    const lastUserText = lastUserTextFromContext();
    if (!lastUserText) return chat;

    let lastUserPromptText = '';
    for (let i = chat.length - 1; i >= 0; i--) {
        const msg = chat[i];
        if (String(msg?.role || '') !== 'user') continue;
        lastUserPromptText = contentText(msg?.content);
        break;
    }
    if (lastUserPromptText === lastUserText) return chat;

    return [
        ...chat,
        { role: 'user', content: lastUserText, identifier: 'pi_last_user' },
    ];
}

function stripSyntheticRows(chat) {
    if (!Array.isArray(chat)) return chat;
    return chat.filter((msg) => String(msg?.identifier || '') !== 'pi_last_user');
}

function mountFormatted(json, formattedPane) {
    let messages;
    try {
        messages = JSON.parse(json);
    } catch {
        formattedPane.appendChild(makeInfo('(not valid JSON — switch to Raw to edit)', 'opacity:0.5;font-style:italic'));
        return () => { };
    }
    if (!Array.isArray(messages)) {
        formattedPane.appendChild(makeInfo('(not a message array)', 'opacity:0.5'));
        return () => { };
    }
    let cancelled = false;
    let index = 0;
    const chunkSize = 40;
    const appendChunk = () => {
        if (cancelled) return;
        const frag = document.createDocumentFragment();
        const end = Math.min(index + chunkSize, messages.length);
        for (; index < end; index++) {
            frag.appendChild(makeFormattedMessage(messages[index]));
        }
        formattedPane.appendChild(frag);
        if (index < messages.length) {
            requestAnimationFrame(appendChunk);
        }
    };
    appendChunk();
    return () => {
        cancelled = true;
    };
}

async function showPromptInspector(input) {
    if (consumeGenerationCancelled()) return input;
    const template = $(await renderExtensionTemplateAsync(path, 'template'));
    const textarea = template.find('#inspectPrompt');
    textarea.val(input);

    const rawPane = template.find('#piRawPane')[0];
    const formattedPane = template.find('#piFormattedPane')[0];
    const tabRaw = template.find('#piTabRaw')[0];
    const tabFormatted = template.find('#piTabFormatted')[0];
    let detachFormatted = null;

    function showTab(tab) {
        if (tab === 'formatted') {
            formattedPane.innerHTML = '';
            if (detachFormatted) detachFormatted();
            detachFormatted = mountFormatted(textarea.val(), formattedPane);
            rawPane.style.display = 'none';
            formattedPane.style.display = '';
            tabRaw.classList.remove('pi-tab-active');
            tabFormatted.classList.add('pi-tab-active');
        } else {
            if (detachFormatted) {
                detachFormatted();
                detachFormatted = null;
            }
            formattedPane.innerHTML = '';
            rawPane.style.display = '';
            formattedPane.style.display = 'none';
            tabFormatted.classList.remove('pi-tab-active');
            tabRaw.classList.add('pi-tab-active');
        }
    }

    tabRaw.addEventListener('click', () => showTab('raw'));
    tabFormatted.addEventListener('click', () => showTab('formatted'));

    const customButton = {
        text: 'Cancel generation',
        result: POPUP_RESULT.CANCELLED,
        appendAtEnd: true,
        action: async () => {
            await stopGeneration();
            await popup.complete(POPUP_RESULT.CANCELLED);
        },
    };
    const popup = new Popup(template, POPUP_TYPE.CONFIRM, '', { wide: true, large: true, okButton: 'Save changes', cancelButton: 'Discard changes', customButtons: [customButton] });
    const result = await popup.show();
    if (detachFormatted) {
        detachFormatted();
        detachFormatted = null;
    }

    if (!result) {
        return input;
    }

    return String(textarea.val());
}

eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, async (data) => {
    if (!inspectEnabled || data.dryRun || !isChatCompletion()) return;
    if (consumeGenerationCancelled()) return;
    if (data?.__memu_cancelled === true) return;

    const promptJson = JSON.stringify(withSyntheticLastUser(data.chat));
    const result = await showPromptInspector(promptJson);

    if (result === promptJson) return;

    try {
        const chat = stripSyntheticRows(JSON.parse(result));
        if (Array.isArray(chat) && Array.isArray(data.chat)) {
            data.chat.length = 0;
            for (const item of chat) data.chat.push(item);
        }
    } catch {
        toastr.error('Invalid JSON');
    }
});

eventSource.on(event_types.GENERATE_AFTER_COMBINE_PROMPTS, async (data) => {
    if (!inspectEnabled || data.dryRun || isChatCompletion()) return;
    if (consumeGenerationCancelled()) return;
    if (data?.__memu_cancelled === true) return;
    const result = await showPromptInspector(data.prompt);
    if (result !== data.prompt) data.prompt = result;
});

eventSource.on(event_types.GENERATION_STARTED, () => {
    generationCancelled = false;
});

eventSource.on(event_types.GENERATION_STOPPED, () => {
    generationCancelled = true;
});

(function init() {
    addLaunchButton();
})();
