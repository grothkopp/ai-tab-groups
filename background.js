// Background script for AI Tab Sorter

let aiSession = null;
let runningTabs = new Set();

async function initializeAI() {

  let systemPrompt = `
You are a helpful assistant that helps users sort their tabs into logical groups based on their content and purpose.
You always answer with a list of exactly 9 comma-separated english tags that best categorize the tabs.
IMPORTANT: TAGS MUST ALWAYS BE IN ENGLISH, TRANSLATE IF NEEDED! 
`;


  try {
    session = await ai.languageModel.create({
      systemPrompt: systemPrompt 
    });
    console.log('AI session initialized successfully');
    return session;
  } catch (error) {
    console.error('Failed to initialize AI session:', error);
    return null;
  }
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

async function generateTags(content, tab , retryCount = 0) {
  const MAX_RETRIES = 3;

  console.log('Generating tags...,', tab); 
  try {
    localAISession = await initializeAI();
   
    let tabGroups = '';
    const groups = await chrome.tabGroups.query({ windowId: tab.windowId });
    for (const group of groups) {
      tabGroups += `${group.title}, `;
    }
    tabGroups = tabGroups.slice(0, -2);
    console.log('Tab groups:', tabGroups);
  
    let title = '';
    let url = '';
    if (tab.title) title = tab.title;
    if (tab.url) url = tab.url;
    
    const userPrompt = `
      These are the current tab groups, if any matches the content of this webpage include it in the tag list:
      ${tabGroups}
      Analyze this webpage and provide 9 tags (TAGS MUST BE IN ENGLISH! TRANSLATE IF NEEDED!):
      ${url}
      ${title}
      ${content.slice(0, 1000)}
    `;

    const response = await localAISession.prompt(userPrompt);
    const tags = response.split(',').map(tag => tag.trim());
    
    console.log('Generated tags:', tags, tab, tabGroups);
    
    // Ensure we have exactly 5 tags
    if (!Array.isArray(tags)) {
      throw new Error('Invalid tags format');
    }
    
    return tags;
  } catch (error) {
    console.error(`Error generating tags (attempt ${retryCount + 1}/${MAX_RETRIES}):`, error);
    
    if (retryCount < MAX_RETRIES - 1) {
      console.log(`Retrying... (${retryCount + 2}/${MAX_RETRIES})`);
      // Add a small delay before retrying
      await new Promise(resolve => setTimeout(resolve, 100 * (retryCount + 1)));
      return generateTags(content, tab, retryCount + 1);
    }
    
    return null;
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

async function processTab(tab) {
  // Skip if tab is already in a group
  if (tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
    return;
  }

  console.log(runningTabs, tab.id);
  if (runningTabs.has(tab.id))  {
    console.log('Tab is already being processed', tab.id);
    return;
  }
  runningTabs.add(tab.id);
 
  // Skip if tab has no URL
  console.log(tab, tab.url);

  if (!tab.url || tab.url =='chrome://newtab/') {
    return;
  }

  // Get tab content
  const content = await getTabContent(tab.id);
  
  // Generate tags
  const tags = await generateTags(content, tab);
  if (!tags) {
    return;
  }
  
  // Try to find matching group for each tag
  found = false;

  for (const tag of tags) {
    try {
      const groupId = await findTabGroup(tab.windowId, tag);
     
      if (groupId !== false) {
        // Add tab to group
        await chrome.tabs.group({
          tabIds: tab.id,
          groupId
        });
        found = true;
        break;
      }

    }
    catch (error) {
      console.error(`Error processing tag ${tag}:`, error);
      continue;
    }
  }

  if (!found) {
    // Create a new group for the first tag
    const groupId = await chrome.tabs.group({
      tabIds: tab.id,
      createProperties: { windowId: tab.windowId }
    });
    
    // Set the group title after creation
    await chrome.tabGroups.update(groupId, {
      title: tags[0],
      collapsed: false
    });
  }
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

