/**
 * Get the client IP address from the request
 * Handles both IPv4 and IPv6, and works with proxies
 * 
 * @param {Object} req - Express request object
 * @returns {String} - Client IP address
 */
const getClientIP = (req) => {
  // Check for x-forwarded-for header (proxy/load balancer)
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    // x-forwarded-for can be a comma-separated list, take the first one
    return forwarded.split(',')[0].trim();
  }
  
  // Check for x-real-ip header (nginx proxy)
  const realIP = req.headers['x-real-ip'];
  if (realIP) {
    return realIP;
  }
  
  // Use direct connection IP
  let ip = req.ip || req.connection.remoteAddress || req.socket.remoteAddress;
  
  // Handle IPv6 localhost (::1)
  if (ip === '::1' || ip === '::ffff:127.0.0.1') {
    return '127.0.0.1'; // Convert to IPv4 localhost
  }
  
  // Remove IPv6 prefix if present
  if (ip && ip.startsWith('::ffff:')) {
    ip = ip.substring(7);
  }
  
  return ip || 'Unknown';
};

/**
 * Format IP address for display
 * Converts localhost IPs to friendly format
 * 
 * @param {String} ip - IP address
 * @returns {String} - Formatted IP address
 */
const formatIPAddress = (ip) => {
  if (!ip || ip === 'Unknown') {
    return 'Unknown';
  }
  
  // Localhost variations
  if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || ip === 'localhost') {
    return 'Localhost (127.0.0.1)';
  }
  
  // Private network ranges
  if (ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('172.')) {
    return `${ip} (Private Network)`;
  }
  
  return ip;
};

/**
 * Check if IP is localhost
 * 
 * @param {String} ip - IP address
 * @returns {Boolean}
 */
const isLocalhost = (ip) => {
  if (!ip) return false;
  return (
    ip === '127.0.0.1' || 
    ip === '::1' || 
    ip === '::ffff:127.0.0.1' || 
    ip === 'localhost'
  );
};

/**
 * Check if IP is private network
 * 
 * @param {String} ip - IP address
 * @returns {Boolean}
 */
const isPrivateNetwork = (ip) => {
  if (!ip) return false;
  return (
    ip.startsWith('192.168.') || 
    ip.startsWith('10.') || 
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip)
  );
};

module.exports = {
  getClientIP,
  formatIPAddress,
  isLocalhost,
  isPrivateNetwork
};
