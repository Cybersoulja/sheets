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

  return (
    <div className="rss-manager">
      <h1>Raindrops IO RSS Feed File Download Manager</h1>
      
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

      {error && <div className="error">{error}</div>}

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
                
                <a href={item.link} target="_blank" rel="noopener noreferrer" className="view-link">
                  View Original
                </a>
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
