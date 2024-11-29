/**
 * Content script for the AI Tab Groups extension
 * This script handles the UI elements that appear when processing and organizing tabs
 * Styles are defined in content.css
 */

// Create and inject the floating message box that will show processing state and suggested groups
const messageBox = document.createElement('div');
messageBox.className = 'ai-sorter-message-box';
document.body.appendChild(messageBox);

// Timer for auto-hiding the message box
let autoCloseTimer = null;

/**
 * Hides the message box by removing the 'show' class
 * This triggers the CSS transition to slide it up and out of view
 */
function hideMessageBox() {
  messageBox.classList.remove('show');
}

/**
 * Shows the processing state with a loading spinner
 * Called when the extension starts analyzing the current tab
 */
function showProcessing() {
  if (autoCloseTimer) {
    clearTimeout(autoCloseTimer);
    autoCloseTimer = null;
  }
  messageBox.innerHTML = `
    <div class="ai-sorter-close">×</div>
    <div class="ai-sorter-loader-container">
      <div class="ai-sorter-loader"></div>
      <span class="ai-sorter-loader-text">Processing page content...</span>
    </div>
  `;
  messageBox.classList.add('show');
}

/**
 * Displays the suggested tab groups as clickable tags
 * @param {string[]} tags - Array of suggested group names
 * @param {string} highlightedTag - The currently selected/active group
 * @param {string} highlightColor - Color to use for the highlighted tag (matches the tab group color)
 */
function showTags(tags, highlightedTag, highlightColor) {
  if (autoCloseTimer) {
    clearTimeout(autoCloseTimer);
  }
  
  const tagsHtml = tags.map(tag => {
    const isHighlighted = tag === highlightedTag;
    const style = isHighlighted ? `background-color: ${highlightColor}` : '';
    const className = `ai-sorter-tag${isHighlighted ? ' highlighted' : ''}`;
    return `<span class="${className}" style="${style}" data-tag="${tag}">${tag}</span>`;
  }).join('');
  
  messageBox.innerHTML = `
    <div class="ai-sorter-close">×</div>
    <div class="ai-sorter-title">Suggested groups:</div>
    <div class="ai-sorter-tags">${tagsHtml}</div>
  `;

  // Auto-hide the message box after 10 seconds
  autoCloseTimer = setTimeout(hideMessageBox, 10000);
}

// Set up click handlers for the message box
messageBox.addEventListener('click', (e) => {
  const tagElement = e.target.closest('.ai-sorter-tag');
  const closeButton = e.target.closest('.ai-sorter-close');
  
  if (closeButton) {
    // Handle close button click
    hideMessageBox();
  } else if (tagElement && !tagElement.classList.contains('highlighted')) {
    // Handle tag click - send message to move tab to the selected group
    const tag = tagElement.dataset.tag;
    chrome.runtime.sendMessage({ action: 'moveToGroup', tag });
    hideMessageBox();
  }
});

// Listen for messages from the background script to update UI
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'showProcessing') {
    showProcessing();
  } else if (message.action === 'showTags') {
    showTags(message.tags, message.highlightedTag, message.highlightColor);
  } else if (message.action === 'hide') {
    hideMessageBox();
  }
});
