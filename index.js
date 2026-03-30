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

    const promptJson = JSON.stringify(data.chat);
    const result = await showPromptInspector(promptJson);

    if (result === promptJson) return;

    try {
        const chat = JSON.parse(result);
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
    const result = await showPromptInspector(data.prompt);
    if (result !== data.prompt) data.prompt = result;
});

(function init() {
    addLaunchButton();
})();
