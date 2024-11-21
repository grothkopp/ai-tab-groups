// Create and inject the message box styles
const style = document.createElement('style');
style.textContent = `
  .ai-sorter-message-box {
    position: fixed;
    top: -100px;
    left: 50%;
    transform: translateX(-50%);
    background: white;
    padding: 15px 20px;
    border-radius: 8px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    z-index: 10000;
    transition: top 0.3s ease-in-out;
    width: auto;
    min-width: 200px;
    border: 1px solid #e0e0e0;
  }
  
  .ai-sorter-message-box.show {
    top: 20px;
  }
  
  .ai-sorter-close {
    position: absolute;
    top: 8px;
    right: 8px;
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    opacity: 0.6;
    transition: opacity 0.2s;
    font-size: 18px;
    font-family: Arial, sans-serif;
  }

  .ai-sorter-close:hover {
    opacity: 1;
  }
  
  .ai-sorter-loader {
    display: inline-block;
    width: 20px;
    height: 20px;
    border: 2px solid #f3f3f3;
    border-top: 2px solid #3498db;
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin-right: 10px;
  }
  
  .ai-sorter-tags {
    margin-top: 10px;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  
  .ai-sorter-tag {
    padding: 4px 8px;
    border-radius: 4px;
    background: #f0f0f0;
    cursor: pointer;
    transition: background-color 0.2s;
  }
  
  .ai-sorter-tag:hover {
    opacity: 0.8;
  }
  
  .ai-sorter-tag.highlighted {
    color: white;
  }
  
  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
`;
document.head.appendChild(style);

// Create message box element
const messageBox = document.createElement('div');
messageBox.className = 'ai-sorter-message-box';
document.body.appendChild(messageBox);

let autoCloseTimer = null;

function hideMessageBox() {
  messageBox.classList.remove('show');
}

// Function to show the processing state
function showProcessing() {
  if (autoCloseTimer) {
    clearTimeout(autoCloseTimer);
    autoCloseTimer = null;
  }
  messageBox.innerHTML = `
    <div class="ai-sorter-close">×</div>
    <div class="ai-sorter-loader"></div>
    <span>Processing page content...</span>
  `;
  messageBox.classList.add('show');
}

// Function to show tags
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
    <div>Suggested groups:</div>
    <div class="ai-sorter-tags">${tagsHtml}</div>
  `;

  // Set auto-close timer
  autoCloseTimer = setTimeout(hideMessageBox, 10000);
}

// Handle tag clicks and close button
messageBox.addEventListener('click', (e) => {
  const tagElement = e.target.closest('.ai-sorter-tag');
  const closeButton = e.target.closest('.ai-sorter-close');
  
  if (closeButton) {
    hideMessageBox();
  } else if (tagElement && !tagElement.classList.contains('highlighted')) {
    const tag = tagElement.dataset.tag;
    chrome.runtime.sendMessage({ action: 'moveToGroup', tag });
    hideMessageBox();
  }
});

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'showProcessing') {
    showProcessing();
  } else if (message.action === 'showTags') {
    showTags(message.tags, message.highlightedTag, message.highlightColor);
  } else if (message.action === 'hide') {
    hideMessageBox();
  }
});