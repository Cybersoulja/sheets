import { useState, useEffect } from 'react'
import Parser from 'rss-parser'
import './App.css'

// RSS Feed Manager Component
function RSSFeedManager() {
  const [feedUrl, setFeedUrl] = useState('')
  const [feedItems, setFeedItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [downloadQueue, setDownloadQueue] = useState([])
  const [downloadHistory, setDownloadHistory] = useState([])
  const [autoDownload, setAutoDownload] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState({})
  
  // Raindrop.io integration state
  const [raindropToken, setRaindropToken] = useState(localStorage.getItem('raindrop_token'))
  const [raindropUser, setRaindropUser] = useState(null)
  const [raindropCollections, setRaindropCollections] = useState([])
  const [selectedCollection, setSelectedCollection] = useState('')
  const [raindropSyncEnabled, setRaindropSyncEnabled] = useState(false)
  const [savedItems, setSavedItems] = useState(new Set())
  const [savingItems, setSavingItems] = useState(new Set())
  const [notifications, setNotifications] = useState([])
  const [syncProgress, setSyncProgress] = useState({ total: 0, completed: 0, isRunning: false })

  // Parse RSS feed from URL using rss-parser
  const fetchRSSFeed = async (url) => {
    setLoading(true)
    setError('')
    
    try {
      const parser = new Parser({
        customFields: {
          item: ['enclosure', 'media:content', 'media:group']
        }
      })
      
      // Use CORS proxy to fetch the feed
      const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`
      const response = await fetch(proxyUrl)
      
      if (!response.ok) {
        throw new Error(`Failed to fetch feed: ${response.status} ${response.statusText}`)
      }
      
      const data = await response.json()
      
      // Check if we got valid XML/RSS content
      if (!data.contents || data.contents.trim() === '') {
        throw new Error('Feed appears to be empty or invalid')
      }
      
      // Parse the RSS/Atom feed
      const feed = await parser.parseString(data.contents)
      
      // Extract items with better file detection
      const items = feed.items.map((item, index) => {
        const title = item.title || 'No title'
        const link = item.link || ''
        const description = item.contentSnippet || item.content || item.summary || ''
        const pubDate = item.pubDate || item.isoDate || ''
        
        // Enhanced file attachment detection
        let fileUrl = ''
        let fileType = ''
        let fileSize = ''
        
        // Check enclosure (RSS)
        if (item.enclosure && item.enclosure.url) {
          fileUrl = item.enclosure.url
          fileType = item.enclosure.type || ''
          fileSize = item.enclosure.length || ''
        }
        // Check media:content (media RSS)
        else if (item['media:content'] && item['media:content'].$ && item['media:content'].$.url) {
          fileUrl = item['media:content'].$.url
          fileType = item['media:content'].$.type || ''
          fileSize = item['media:content'].$.fileSize || ''
        }
        // Check for links with rel="enclosure" (Atom)
        else if (item.links) {
          const enclosureLink = item.links.find(link => link.rel === 'enclosure')
          if (enclosureLink) {
            fileUrl = enclosureLink.href || ''
            fileType = enclosureLink.type || ''
          }
        }
        
        return {
          id: index,
          title,
          link,
          description,
          pubDate,
          fileUrl,
          fileType,
          fileSize,
          hasFile: !!fileUrl
        }
      })
      
      setFeedItems(items)
      
      // Auto-sync to Raindrop.io if enabled
      if (raindropSyncEnabled && items.length > 0) {
        autoSyncToRaindrop(items)
      }
    } catch (err) {
      console.error('Error fetching RSS feed:', err)
      setError(`Failed to fetch RSS feed: ${err.message}. Please check the URL and try again.`)
    } finally {
      setLoading(false)
    }
  }

  // Add item to download queue
  const addToDownloadQueue = (item) => {
    if (item.hasFile && !downloadQueue.find(q => q.id === item.id)) {
      const queueItem = {
        id: item.id,
        title: item.title,
        url: item.fileUrl,
        type: item.fileType,
        size: item.fileSize,
        status: 'queued',
        addedAt: new Date().toISOString()
      }
      
      setDownloadQueue(prev => [...prev, queueItem])
      
      // Auto-download if enabled
      if (autoDownload) {
        setTimeout(() => downloadFile(queueItem), 100)
      }
    }
  }

  // Remove item from download queue
  const removeFromQueue = (itemId) => {
    setDownloadQueue(prev => prev.filter(item => item.id !== itemId))
    setDownloadProgress(prev => {
      const updated = { ...prev }
      delete updated[itemId]
      return updated
    })
  }

  // Clear completed downloads from queue
  const clearCompleted = () => {
    setDownloadQueue(prev => prev.filter(item => item.status !== 'completed'))
  }

  // Retry failed download
  const retryDownload = (queueItem) => {
    setDownloadQueue(prev => prev.map(item => 
      item.id === queueItem.id ? { ...item, status: 'queued', error: undefined } : item
    ))
    downloadFile(queueItem)
  }

  // Enhanced download file function with progress tracking
  const downloadFile = async (queueItem) => {
    try {
      setDownloadQueue(prev => prev.map(item => 
        item.id === queueItem.id ? { ...item, status: 'downloading' } : item
      ))
      
      setDownloadProgress(prev => ({ ...prev, [queueItem.id]: 0 }))
      
      const response = await fetch(queueItem.url)
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`)
      
      const contentLength = response.headers.get('content-length')
      const total = parseInt(contentLength, 10)
      let loaded = 0
      
      const reader = response.body.getReader()
      const stream = new ReadableStream({
        start(controller) {
          function pump() {
            return reader.read().then(({ done, value }) => {
              if (done) {
                controller.close()
                return
              }
              
              loaded += value.byteLength
              if (total) {
                const progress = Math.round((loaded / total) * 100)
                setDownloadProgress(prev => ({ ...prev, [queueItem.id]: progress }))
              }
              
              controller.enqueue(value)
              return pump()
            })
          }
          return pump()
        }
      })
      
      const blob = await new Response(stream).blob()
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = getFilename(queueItem)
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
      
      // Add to download history
      const historyItem = {
        ...queueItem,
        downloadedAt: new Date().toISOString(),
        filename: getFilename(queueItem),
        size: total || blob.size
      }
      setDownloadHistory(prev => [historyItem, ...prev.slice(0, 49)]) // Keep last 50
      
      setDownloadQueue(prev => prev.map(item => 
        item.id === queueItem.id ? { ...item, status: 'completed', downloadedAt: historyItem.downloadedAt } : item
      ))
      
      setDownloadProgress(prev => {
        const updated = { ...prev }
        delete updated[queueItem.id]
        return updated
      })
      
    } catch (err) {
      console.error('Download failed:', err)
      setDownloadQueue(prev => prev.map(item => 
        item.id === queueItem.id ? { ...item, status: 'failed', error: err.message } : item
      ))
      
      setDownloadProgress(prev => {
        const updated = { ...prev }
        delete updated[queueItem.id]
        return updated
      })
    }
  }

  // Download all queued items
  const downloadAll = async () => {
    const queuedItems = downloadQueue.filter(item => item.status === 'queued')
    for (const item of queuedItems) {
      await downloadFile(item)
      // Small delay between downloads to avoid overwhelming the server
      await new Promise(resolve => setTimeout(resolve, 500))
    }
  }

  // Format file size
  const formatFileSize = (bytes) => {
    if (!bytes) return ''
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(1024))
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i]
  }

  // Raindrop.io API functions
  const raindropAPI = {
    baseURL: 'https://api.raindrop.io/rest/v1',
    
    // Get user info
    async getUser(token) {
      const response = await fetch(`${this.baseURL}/user`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (!response.ok) throw new Error('Failed to get user info')
      return response.json()
    },
    
    // Get collections
    async getCollections(token) {
      const response = await fetch(`${this.baseURL}/collections`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (!response.ok) throw new Error('Failed to get collections')
      return response.json()
    },
    
    // Create bookmark
    async createBookmark(token, bookmark) {
      const response = await fetch(`${this.baseURL}/raindrop`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(bookmark)
      })
      if (!response.ok) throw new Error('Failed to create bookmark')
      return response.json()
    },
    
    // Upload file to bookmark
    async uploadFile(token, raindropId, file) {
      const formData = new FormData()
      formData.append('file', file)
      
      const response = await fetch(`${this.baseURL}/raindrop/${raindropId}/file`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
      })
      if (!response.ok) throw new Error('Failed to upload file')
      return response.json()
    }
  }

  // Initialize Raindrop.io connection
  const initializeRaindrop = async () => {
    if (!raindropToken) return
    
    try {
      const userResponse = await raindropAPI.getUser(raindropToken)
      setRaindropUser(userResponse.user)
      
      const collectionsResponse = await raindropAPI.getCollections(raindropToken)
      setRaindropCollections(collectionsResponse.items || [])
      
      if (collectionsResponse.items && collectionsResponse.items.length > 0) {
        setSelectedCollection(collectionsResponse.items[0]._id.toString())
      }
    } catch (err) {
      console.error('Failed to initialize Raindrop.io:', err)
      setRaindropToken(null)
      localStorage.removeItem('raindrop_token')
    }
  }

  // Add notification
  const addNotification = (message, type = 'info') => {
    const id = Date.now()
    const notification = { id, message, type }
    setNotifications(prev => [...prev, notification])
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id))
    }, 5000)
  }

  // Save RSS item to Raindrop.io
  const saveToRaindrop = async (item, showNotification = true) => {
    if (!raindropToken || !selectedCollection) {
      addNotification('Please configure Raindrop.io integration first', 'error')
      return false
    }
    
    // Check if already saved
    if (savedItems.has(item.link)) {
      if (showNotification) {
        addNotification('Item already saved to Raindrop.io', 'info')
      }
      return true
    }
    
    setSavingItems(prev => new Set(prev).add(item.link))
    
    try {
      const bookmark = {
        link: item.link,
        title: item.title,
        excerpt: item.description ? item.description.substring(0, 200) : '',
        collection: { $id: parseInt(selectedCollection) },
        tags: ['rss-feed']
      }
      
      const result = await raindropAPI.createBookmark(raindropToken, bookmark)
      
      if (result.result && item.hasFile) {
        // If there's a file, try to upload it
        try {
          const fileResponse = await fetch(item.fileUrl)
          if (fileResponse.ok) {
            const blob = await fileResponse.blob()
            const file = new File([blob], getFilename({
              title: item.title,
              type: item.fileType,
              url: item.fileUrl
            }), { type: item.fileType || 'application/octet-stream' })
            
            await raindropAPI.uploadFile(raindropToken, result.item._id, file)
          }
        } catch (fileErr) {
          console.warn('Failed to upload file to Raindrop.io:', fileErr)
        }
      }
      
      setSavedItems(prev => new Set(prev).add(item.link))
      if (showNotification) {
        addNotification('Successfully saved to Raindrop.io!', 'success')
      }
      return true
    } catch (err) {
      console.error('Failed to save to Raindrop.io:', err)
      if (showNotification) {
        addNotification(`Failed to save to Raindrop.io: ${err.message}`, 'error')
      }
      return false
    } finally {
      setSavingItems(prev => {
        const newSet = new Set(prev)
        newSet.delete(item.link)
        return newSet
      })
    }
  }

  // Connect to Raindrop.io using test token
  const connectRaindrop = () => {
    const token = prompt('Enter your Raindrop.io test token:\n(Get one from https://app.raindrop.io/settings/integrations)')
    
    if (token) {
      setRaindropToken(token)
      localStorage.setItem('raindrop_token', token)
    }
  }

  // Disconnect from Raindrop.io
  const disconnectRaindrop = () => {
    setRaindropToken(null)
    setRaindropUser(null)
    setRaindropCollections([])
    setSelectedCollection('')
    setRaindropSyncEnabled(false)
    setSavedItems(new Set())
    setSavingItems(new Set())
    setSyncProgress({ total: 0, completed: 0, isRunning: false })
    localStorage.removeItem('raindrop_token')
  }

  // Auto-sync RSS items to Raindrop.io
  const autoSyncToRaindrop = async (items) => {
    if (!raindropSyncEnabled || !raindropToken || !selectedCollection) return
    
    const newItems = items.filter(item => !savedItems.has(item.link))
    if (newItems.length === 0) return
    
    setSyncProgress({ total: newItems.length, completed: 0, isRunning: true })
    let completed = 0
    let successful = 0
    
    for (const item of newItems) {
      try {
        const success = await saveToRaindrop(item, false) // Don't show individual notifications
        if (success) successful++
        completed++
        setSyncProgress(prev => ({ ...prev, completed }))
        
        // Small delay between syncs
        await new Promise(resolve => setTimeout(resolve, 500))
      } catch (err) {
        console.error('Auto-sync failed for item:', item.title, err)
        completed++
        setSyncProgress(prev => ({ ...prev, completed }))
      }
    }
    
    setSyncProgress({ total: 0, completed: 0, isRunning: false })
    addNotification(`Auto-sync complete: ${successful}/${newItems.length} items saved`, 
                   successful === newItems.length ? 'success' : 'warning')
  }

  // Sync all new items manually
  const syncAllNew = async () => {
    if (!feedItems.length) return
    await autoSyncToRaindrop(feedItems)
  }

  // Safe date formatting function to prevent crashes
  const formatDate = (dateString) => {
    if (!dateString || dateString.trim() === '') {
      return 'Unknown date'
    }
    
    try {
      const date = new Date(dateString)
      if (isNaN(date.getTime())) {
        return 'Unknown date'
      }
      return date.toLocaleDateString()
    } catch (err) {
      return 'Unknown date'
    }
  }

  // Format description with proper ellipsis handling
  const formatDescription = (description, maxLength = 150) => {
    if (!description) return 'No description available'
    
    const trimmed = description.trim()
    if (trimmed.length <= maxLength) {
      return trimmed
    }
    
    return trimmed.substring(0, maxLength) + '...'
  }

  const getFileExtension = (mimeType) => {
    const extensions = {
      'audio/mpeg': '.mp3',
      'audio/mp4': '.m4a',
      'video/mp4': '.mp4',
      'application/pdf': '.pdf',
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'text/plain': '.txt',
      'application/zip': '.zip'
    }
    return extensions[mimeType] || ''
  }

  // Get filename from URL if MIME type is unknown
  const getFilename = (queueItem) => {
    const baseFilename = queueItem.title.replace(/[^a-zA-Z0-9]/g, '_')
    const extension = getFileExtension(queueItem.type)
    
    if (extension) {
      return baseFilename + extension
    }
    
    // Try to extract extension from URL
    try {
      const url = new URL(queueItem.url)
      const pathname = url.pathname
      const lastDotIndex = pathname.lastIndexOf('.')
      if (lastDotIndex > 0 && lastDotIndex < pathname.length - 1) {
        const urlExtension = pathname.substring(lastDotIndex)
        return baseFilename + urlExtension
      }
    } catch (err) {
      // URL parsing failed, use no extension
    }
    
    return baseFilename
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (feedUrl.trim()) {
      fetchRSSFeed(feedUrl.trim())
    }
  }

  // Initialize Raindrop.io on component mount
  useEffect(() => {
    if (raindropToken) {
      initializeRaindrop()
    }
  }, [raindropToken])

  return (
    <div className="rss-manager">
      <h1>Raindrops IO RSS Feed File Download Manager</h1>
      
      {/* Raindrop.io Integration */}
      <div className="raindrop-integration">
        <h2>Raindrop.io Integration</h2>
        <div className="raindrop-status">
          {raindropUser ? (
            <div className="raindrop-connected">
              <div className="raindrop-user-info">
                <span className="user-name">Connected as: {raindropUser.name}</span>
                <span className="user-email">({raindropUser.email})</span>
              </div>
              <div className="raindrop-controls">
                <div className="collection-selector">
                  <label>Collection:</label>
                  <select 
                    value={selectedCollection} 
                    onChange={(e) => setSelectedCollection(e.target.value)}
                  >
                    {raindropCollections.map(collection => (
                      <option key={collection._id} value={collection._id}>
                        {collection.title}
                      </option>
                    ))}
                  </select>
                </div>
                <label className="auto-sync-toggle">
                  <input 
                    type="checkbox" 
                    checked={raindropSyncEnabled}
                    onChange={(e) => setRaindropSyncEnabled(e.target.checked)}
                  />
                  Auto-sync new RSS items
                </label>
                {feedItems.length > 0 && (
                  <button 
                    onClick={syncAllNew} 
                    className="sync-all-btn"
                    disabled={syncProgress.isRunning}
                  >
                    {syncProgress.isRunning ? 'Syncing...' : 'Sync All New'}
                  </button>
                )}
                <button onClick={disconnectRaindrop} className="disconnect-btn">
                  Disconnect
                </button>
              </div>
            </div>
          ) : (
            <div className="raindrop-disconnected">
              <p>Connect to Raindrop.io to automatically save RSS items as bookmarks</p>
              <button onClick={connectRaindrop} className="connect-btn">
                Connect Raindrop.io
              </button>
            </div>
          )}
        </div>
      </div>
      
      {/* RSS Feed Input */}
      <form onSubmit={handleSubmit} className="feed-form">
        <div className="input-group">
          <input
            type="url"
            value={feedUrl}
            onChange={(e) => setFeedUrl(e.target.value)}
            placeholder="Enter RSS feed URL..."
            className="feed-input"
            required
          />
          <button type="submit" disabled={loading} className="fetch-btn">
            {loading ? 'Loading...' : 'Fetch Feed'}
          </button>
        </div>
      </form>

      {/* Sync Progress */}
      {syncProgress.isRunning && (
        <div className="sync-progress">
          <div className="sync-progress-bar">
            <div 
              className="sync-progress-fill" 
              style={{width: `${(syncProgress.completed / syncProgress.total) * 100}%`}}
            ></div>
          </div>
          <span className="sync-progress-text">
            Syncing to Raindrop.io: {syncProgress.completed}/{syncProgress.total}
          </span>
        </div>
      )}

      {error && <div className="error">{error}</div>}

      {/* Notifications */}
      {notifications.length > 0 && (
        <div className="notifications">
          {notifications.map(notification => (
            <div key={notification.id} className={`notification ${notification.type}`}>
              {notification.message}
              <button 
                onClick={() => setNotifications(prev => prev.filter(n => n.id !== notification.id))}
                className="notification-close"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* RSS Feed Items */}
      {feedItems.length > 0 && (
        <div className="feed-items">
          <h2>RSS Feed Items ({feedItems.length})</h2>
          <div className="items-grid">
            {feedItems.map(item => (
              <div key={item.id} className="feed-item">
                <h3>{item.title}</h3>
                <p className="description">{formatDescription(item.description)}</p>
                <p className="pub-date">{formatDate(item.pubDate)}</p>
                
                {item.hasFile && (
                  <div className="file-info">
                    <div className="file-details">
                      <span className="file-type">{item.fileType || 'Unknown'}</span>
                      {item.fileSize && <span className="file-size">{formatFileSize(parseInt(item.fileSize))}</span>}
                    </div>
                    <button 
                      onClick={() => addToDownloadQueue(item)}
                      className="download-btn"
                      disabled={downloadQueue.find(q => q.id === item.id)}
                    >
                      {downloadQueue.find(q => q.id === item.id) ? 'Queued' : 'Add to Downloads'}
                    </button>
                  </div>
                )}
                
                <div className="item-actions">
                  <a href={item.link} target="_blank" rel="noopener noreferrer" className="view-link">
                    View Original
                  </a>
                  {raindropUser && (
                    <div className="raindrop-item-controls">
                      {savedItems.has(item.link) ? (
                        <span className="saved-indicator">✓ Saved</span>
                      ) : savingItems.has(item.link) ? (
                        <span className="saving-indicator">⏳ Saving...</span>
                      ) : (
                        <button 
                          onClick={() => saveToRaindrop(item)} 
                          className="save-raindrop-btn"
                          title="Save to Raindrop.io"
                        >
                          Save to Raindrop.io
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Download Manager */}
      {downloadQueue.length > 0 && (
        <div className="download-queue">
          <div className="queue-header">
            <h2>Download Queue ({downloadQueue.length})</h2>
            <div className="queue-controls">
              <label className="auto-download-toggle">
                <input 
                  type="checkbox" 
                  checked={autoDownload}
                  onChange={(e) => setAutoDownload(e.target.checked)}
                />
                Auto-download
              </label>
              <button 
                onClick={downloadAll}
                className="download-all-btn"
                disabled={!downloadQueue.some(item => item.status === 'queued')}
              >
                Download All
              </button>
              <button 
                onClick={clearCompleted}
                className="clear-completed-btn"
                disabled={!downloadQueue.some(item => item.status === 'completed')}
              >
                Clear Completed
              </button>
            </div>
          </div>
          <div className="queue-items">
            {downloadQueue.map(item => (
              <div key={item.id} className={`queue-item ${item.status}`}>
                <div className="queue-info">
                  <span className="queue-title">{item.title}</span>
                  <div className="queue-details">
                    <span className="queue-status">{item.status}</span>
                    {item.size && <span className="queue-size">{formatFileSize(parseInt(item.size))}</span>}
                    {item.type && <span className="queue-type">{item.type}</span>}
                  </div>
                  {item.status === 'downloading' && downloadProgress[item.id] !== undefined && (
                    <div className="progress-bar">
                      <div 
                        className="progress-fill" 
                        style={{width: `${downloadProgress[item.id]}%`}}
                      ></div>
                      <span className="progress-text">{downloadProgress[item.id]}%</span>
                    </div>
                  )}
                  {item.status === 'failed' && (
                    <span className="error-msg">{item.error}</span>
                  )}
                </div>
                <div className="queue-actions">
                  {item.status === 'queued' && (
                    <button onClick={() => downloadFile(item)} className="start-download">
                      Download
                    </button>
                  )}
                  {item.status === 'failed' && (
                    <button onClick={() => retryDownload(item)} className="retry-download">
                      Retry
                    </button>
                  )}
                  {(item.status === 'queued' || item.status === 'failed') && (
                    <button onClick={() => removeFromQueue(item.id)} className="remove-download">
                      Remove
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Download History */}
      {downloadHistory.length > 0 && (
        <div className="download-history">
          <h2>Download History ({downloadHistory.length})</h2>
          <div className="history-items">
            {downloadHistory.slice(0, 10).map((item, index) => (
              <div key={`history-${index}`} className="history-item">
                <span className="history-title">{item.title}</span>
                <div className="history-details">
                  <span className="history-filename">{item.filename}</span>
                  <span className="history-size">{formatFileSize(item.size)}</span>
                  <span className="history-date">{formatDate(item.downloadedAt)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function App() {
  return (
    <main>
      <RSSFeedManager />
    </main>
  )
}
