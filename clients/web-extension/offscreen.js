// Offscreen document for clipboard operations
// Required because service workers can't directly access the clipboard

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'offscreen') return;
  
  switch (message.type) {
    case 'clipboard:write':
      writeToClipboard(message.data);
      break;
    case 'clipboard:writeImage':
      writeImageToClipboard(message.data);
      break;
    case 'clipboard:read':
      readFromClipboard().then(sendResponse);
      return true;
  }
});

async function writeToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    console.log('[Offscreen] Text written to clipboard');
  } catch (error) {
    console.error('[Offscreen] Error writing to clipboard:', error);
    // Fallback using textarea
    const textarea = document.getElementById('clipboard');
    textarea.value = text;
    textarea.select();
    document.execCommand('copy');
  }
}

async function writeImageToClipboard(base64Data) {
  try {
    // Convert base64 to blob
    const response = await fetch(base64Data);
    const blob = await response.blob();
    
    await navigator.clipboard.write([
      new ClipboardItem({ [blob.type]: blob })
    ]);
    console.log('[Offscreen] Image written to clipboard');
  } catch (error) {
    console.error('[Offscreen] Error writing image to clipboard:', error);
  }
}

async function readFromClipboard() {
  try {
    const text = await navigator.clipboard.readText();
    return { success: true, content: text };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
