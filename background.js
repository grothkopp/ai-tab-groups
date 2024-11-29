/**
 * Background script for AI Tab Groups Chrome Extension
 * This script handles the core logic of analyzing tab content and organizing them into groups
 * using AI-powered categorization.
 */

// Global state management
let aiSession = null;  // Holds the AI language model session
let runningTabs = new Set();  // Tracks tabs currently being processed
let requestQueue = [];  // Queue of pending tab analysis requests
let isProcessingQueue = false;  // Flag to prevent concurrent queue processing

/**
 * Initializes the AI language model session with a specific system prompt
 * The AI is configured to generate exactly 9 English tags for categorizing tabs
 * @returns {Promise<Object|null>} The initialized AI session or null if initialization fails
 */
async function initializeAI() {
  if (aiSession) return aiSession;

  let systemPrompt = `
You are a helpful assistant that helps users sort their tabs into logical groups based on their content and purpose.
You always answer with a list of exactly 9 comma-separated english tags that best categorize the tabs.
IMPORTANT: TAGS MUST ALWAYS BE IN ENGLISH, TRANSLATE IF NEEDED! 
`;

  try {
    aiSession = await ai.languageModel.create({
      systemPrompt: systemPrompt 
    });
    console.log('AI session initialized successfully');
    return aiSession;
  } catch (error) {
    console.error('Failed to initialize AI session:', error);
    return null;
  }
}

// Initialize AI session when the extension loads
initializeAI();

/**
 * Processes the queue of tab analysis requests sequentially
 * This ensures we don't overwhelm the AI service with concurrent requests
 */
async function processQueue() {
  if (isProcessingQueue || requestQueue.length === 0) return;
  
  isProcessingQueue = true;
  console.log('Processing queue, length:', requestQueue.length);

  try {
    while (requestQueue.length > 0) {
      const request = requestQueue[0];
      try {
        const tags = await generateTagsForTab(request.content, request.tab);
        if (tags) {
          await groupTab(request.tab, tags);
        }
      } catch (error) {
        console.error('Error processing request:', error);
      } finally {
        runningTabs.delete(request.tab.id);
        requestQueue.shift(); // Remove the processed request
      }
    }
  } finally {
    isProcessingQueue = false;
    console.log('Queue processing completed');
  }
}

/**
 * Generates tags for a tab using AI analysis
 * @param {string} content - The text content of the tab
 * @param {chrome.tabs.Tab} tab - The tab object being analyzed
 * @param {number} retryCount - Number of retry attempts (max 3)
 * @returns {Promise<string[]|null>} Array of generated tags or null if generation fails
 */
async function generateTagsForTab(content, tab, retryCount = 0) {
  if (!aiSession) {
    aiSession = await initializeAI();
    if (!aiSession) return null;
  }

  try {
    // Show processing state in the content script
    await sendTabMessage(tab.id, { action: 'showProcessing' });

    // Get existing tab group names to potentially reuse them
    let tabGroups = '';
    const groups = await chrome.tabGroups.query({ windowId: tab.windowId });
    for (const group of groups) {
      tabGroups += `${group.title}, `;
    }
    tabGroups = tabGroups.slice(0, -2);

    let title = tab.title || '';
    let url = tab.url || '';

    // Construct prompt for AI analysis
    // Include existing groups, URL, title, and page content
    // Limit content to 1000 chars to stay within token limits
    const userPrompt = `
          These are the current tab groups, if any matches the content of this webpage include it in the tag list:
          ${tabGroups}
          Analyze this webpage and provide 9 tags (TAGS MUST BE IN ENGLISH! TRANSLATE IF NEEDED!):
          ${url}
          ${title}
          ${content.slice(0, 1000)}
        `;

    const response = await aiSession.prompt(userPrompt);
    const tags = response.split(',').map(tag => tag.trim());

    // Return top 5 tags for the UI
    return tags.slice(0, 5);

  } catch (error) {
    console.log('Error generating tags:', error);
    if (retryCount < 2) {
      // Reset session and retry up to 2 times
      aiSession = null;
      return generateTagsForTab(content, tab, retryCount + 1);
    }
    else {
      console.log('Failed to generate tags after 3 attempts');
      await sendTabMessage(tab.id, { action: 'hide' });
    }
    return null;
  }
}

/**
 * Groups a tab based on AI-generated tags
 * Either adds the tab to an existing group with a matching tag
 * or creates a new group with the first tag
 * @param {chrome.tabs.Tab} tab - The tab to be grouped
 * @param {string[]} tags - Array of AI-generated tags
 */
async function groupTab(tab, tags) {
  if (!tab || !tags || tags.length === 0) return;
  
  let groupId = null;
  let matchedTag = null;

  // First try to find an existing group matching any of the tags
  for (const tag of tags) {
    const existingGroupId = await findTabGroup(tab.windowId, tag);
    if (existingGroupId) {
      groupId = existingGroupId;
      matchedTag = tag;
      break;
    }
  }
  
  // If no matching group found, create a new one with the first tag
  if (groupId === null) {
    matchedTag = tags[0];
    const colors = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];
    const color_index = Math.floor(Math.random() * colors.length);
    const color = colors[color_index];
    
    groupId = await chrome.tabs.group({
      tabIds: [tab.id],
      createProperties: { windowId: tab.windowId }
    });
    
    await chrome.tabGroups.update(groupId, {
      title: matchedTag,
      color: color
    });
  } else {
    // Add tab to existing group
    await chrome.tabs.group({
      tabIds: [tab.id],
      groupId: groupId
    });
  }

  // Map Chrome's color names to their hex values for UI highlighting
  const group = await chrome.tabGroups.get(groupId);
  const real_colors = {'grey':'#5f6368', 'blue':'#1973e8', 'red':'#d93025', 'yellow':'#f9ab01', 'green':'#188037', 'pink':'#d01884', 'purple':'#a142f4', 'cyan':'#007b83', 'orange':'#fa903e'};

  // Update the UI with tags and highlight the selected tag
  await sendTabMessage(tab.id, {
    action: 'showTags',
    tags: tags.slice(0, 5),
    highlightedTag: matchedTag,
    highlightColor: real_colors[group.color]
  });
}

/**
 * Processes a tab by extracting its content and queueing it for AI analysis
 * Skips tabs that are already grouped or being processed
 * @param {chrome.tabs.Tab} tab - The tab to process
 */
async function processTab(tab) {
  // Skip if tab is already in a group
  if (tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
    return;
  }

  // Skip if tab is already being processed
  if (runningTabs.has(tab.id)) {
    console.log('Tab is already being processed', tab.id);
    return;
  }

  // Skip empty tabs and chrome://newtab 
  if (!tab.url || tab.url === 'chrome://newtab/') {
    return;
  }

  runningTabs.add(tab.id);

  const content = await getTabContent(tab.id);
  
  // Queue tab for processing
  requestQueue.push({ tab, content });
  processQueue();
}

/**
 * Extracts the text content of a tab
 * @param {number} tabId - The ID of the tab to extract content from
 * @returns {Promise<string>} The extracted content
 */
async function getTabContent(tabId) {
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      function: () => document.body.innerText
    });
    return result;
  } catch (error) {
    console.log(`Could not extract content from tab ${tabId}:`, error);
    return '';
  }
}

/**
 * Finds a tab group matching a given tag name
 * @param {number} windowId - The ID of the window to search in
 * @param {string} tagName - The name of the tag to search for
 * @returns {Promise<number|null>} The ID of the matching group or null if not found
 */
async function findTabGroup(windowId, tagName) {
  // Get all tab groups in the window
  const groups = await chrome.tabGroups.query({ windowId });
  
  // Look for existing group with the tag name
  let existingGroup = groups.find(group => group.title.toLowerCase() === tagName.toLowerCase());
 
  // if no existing group found, search for groups while removing s as last character of title and tagName
  if (!existingGroup) {
    tagName = tagName.toLowerCase();
    if (tagName.slice(-1) === 's') {
      tagName = tagName.slice(0, -1);
    }
    for (const group of groups) {
      title = group.title.toLowerCase();
      if (group.title.slice(-1) === 's') {
        title = title.slice(0, -1);
      }
      if (title === tagName) {
        existingGroup = group;
        break;
      }
    }
  }
  
  
  if (existingGroup) {
    return existingGroup.id;
  }

  return false;
}

/**
 * Sends a message to a tab's content script
 * @param {number} tabId - The ID of the tab to send the message to
 * @param {Object} message - The message to send
 * @returns {Promise<boolean>} Whether the message was sent successfully
 */
async function sendTabMessage(tabId, message) {
  try {
    await chrome.tabs.sendMessage(tabId, message);
    return true;
  } catch (error) {
    console.log(`Failed to send message to tab ${tabId}:`, message.action);
    return false;
  }
}

// Listen for tab updates
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Only process when the tab completes loading
  if (changeInfo.status === 'complete' && tab.url) {
    processTab(tab);
  }
});


// Add listener for tag click messages
chrome.runtime.onMessage.addListener(async (message, sender) => {
  if (message.action === 'moveToGroup' && sender.tab) {
    const tab = sender.tab;
    await groupTab(tab, [message.tag]);
  }
});
