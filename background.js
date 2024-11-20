// Background script for AI Tab Sorter

let aiSession = null;
let runningTabs = new Set();
let requestQueue = [];
let isProcessingQueue = false;

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

async function startSpinner(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { action: 'startSpinner' });
  } catch (error) {
    console.log('Could not start spinner:', error);
  }
}

async function stopSpinner(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { action: 'stopSpinner' });
  } catch (error) {
    console.log('Could not stop spinner:', error);
  }
}

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
        if (request.onComplete) {
          await request.onComplete();
        }
        requestQueue.shift(); // Remove the processed request
      }
    }
  } finally {
    isProcessingQueue = false;
    console.log('Queue processing completed');
  }
}

async function generateTagsForTab(content, tab, retryCount = 0) {
  const MAX_RETRIES = 3;

  console.log('Generating tags...', tab); 
  try {
    if (!aiSession) {
      aiSession = await initializeAI();
      if (!aiSession) throw new Error('Failed to initialize AI session');
    }
   
    let tabGroups = '';
    const groups = await chrome.tabGroups.query({ windowId: tab.windowId });
    for (const group of groups) {
      tabGroups += `${group.title}, `;
    }
    tabGroups = tabGroups.slice(0, -2);
    console.log('Tab groups:', tabGroups);
  
    let title = tab.title || '';
    let url = tab.url || '';
    
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
    
    console.log('Generated tags:', tags, tab, tabGroups);
    
    if (!Array.isArray(tags)) {
      throw new Error('Invalid tags format');
    }
    
    return tags;
  } catch (error) {
    console.log(`Error generating tags (attempt ${retryCount + 1}/${MAX_RETRIES}):`, error);
    
    if (retryCount < MAX_RETRIES - 1) {
      console.log(`Retrying... (${retryCount + 2}/${MAX_RETRIES})`);
      await new Promise(resolve => setTimeout(resolve, 100 * (retryCount + 1)));
      return generateTagsForTab(content, tab, retryCount + 1);
    }
    
    return null;
  }
}

async function groupTab(tab, tags) {
  let found = false;

  for (const tag of tags) {
    try {
      const groupId = await findTabGroup(tab.windowId, tag);
     
      if (groupId !== false) {
        await chrome.tabs.group({
          tabIds: tab.id,
          groupId
        });
        found = true;
        break;
      }
    } catch (error) {
      console.error(`Error processing tag ${tag}:`, error);
      continue;
    }
  }

  if (!found) {
    try {
      const groupId = await chrome.tabs.group({
        tabIds: tab.id,
        createProperties: { windowId: tab.windowId }
      });
      
      await chrome.tabGroups.update(groupId, {
        title: tags[0],
        collapsed: false
      });
    } catch (error) {
      console.error('Error creating new group:', error);
    }
  }
}

async function processTab(tab) {
  if (tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
    return;
  }

  if (runningTabs.has(tab.id)) {
    console.log('Tab is already being processed', tab.id);
    return;
  }

  if (!tab.url || tab.url === 'chrome://newtab/') {
    return;
  }

  runningTabs.add(tab.id);
  await startSpinner(tab.id);
  
  const content = await getTabContent(tab.id);
  
  // Add request to queue
  requestQueue.push({ 
    tab, 
    content,
    onComplete: async () => {
      runningTabs.delete(tab.id);
      await stopSpinner(tab.id);
    }
  });
  processQueue();
}

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

// Listen for tab updates
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Only process when the tab completes loading
  if (changeInfo.status === 'complete' && tab.url) {
    processTab(tab);
  }
});

// Keep the manual sorting functionality
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'sortTabs') {
    (async () => {
      try {
        const tabContents = await getTabContents();
        const groups = await categorizeTabs(tabContents);
        
        if (groups) {
          await sortTabsIntoGroups(groups);
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false });
        }
      } catch (error) {
        console.error('Tab sorting failed:', error);
        sendResponse({ success: false });
      }
    })();
    return true; // Indicates we'll send response asynchronously
  }
});

async function getTabContents() {
  const tabs = await chrome.tabs.query({});
  return Promise.all(tabs.map(async (tab) => {
    try {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        function: () => document.body.innerText
      });
      return {
        id: tab.id,
        url: tab.url,
        title: tab.title,
        content: result
      };
    } catch (error) {
      console.error(`Could not extract content from tab ${tab.id}:`, error);
      return {
        id: tab.id,
        url: tab.url,
        title: tab.title,
        content: ''
      };
    }
  }));
}
