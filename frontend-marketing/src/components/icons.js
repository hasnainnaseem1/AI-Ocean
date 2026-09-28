import React from 'react';
import {
  Zap, Star, Shield, ShieldCheck, BarChart3, LineChart, PieChart, Upload, Download,
  Clock, CheckCircle, Check, XCircle, AlertCircle, Info, Mail, MessageCircle,
  MessageSquare, Phone, MapPin, Send, ArrowRight, ArrowUpRight, ChevronRight,
  Sparkles, Target, Users, User, Server, Cpu, HardDrive, Database, Cloud, CloudCog,
  Lock, Unlock, Key, Terminal, Code, Code2, Braces, Box, Boxes, Layers, Gauge,
  Activity, TrendingUp, TrendingDown, Calendar, CreditCard, Wallet, DollarSign,
  Calculator, Search, Filter, Settings, SlidersHorizontal, Rocket, Play, Pause,
  Globe, Wifi, RefreshCw, Repeat, GitBranch, Package, Image, FileText, BookOpen,
  Brain, Bot, Network, Split, Timer, Infinity as InfinityIcon, Eye, Fingerprint,
  Plug, Workflow, Waypoints, Container, MemoryStick, Microchip, CircuitBoard,
  Flame, Compass, Tag, Tags, Bell, Headphones, LifeBuoy, Building2, Scale,
} from 'lucide-react';

/**
 * Icon registry for admin-authored content.
 *
 * Every block item's `icon` field is a free-text string an admin typed in the
 * admin center. Before this registry existed the renderer knew sixteen names
 * and printed anything else as raw text — which is why cards on the live site
 * literally read "trending-up" and "calculator" inside their icon chips.
 *
 * Two rules follow from that:
 *   1. The map is broad enough to cover what an admin plausibly reaches for on
 *      an infrastructure product, and
 *   2. an unrecognised name NEVER falls through to raw text — it renders a
 *      neutral mark instead, so a typo is a dull icon rather than a broken one.
 *
 * `ICON_NAMES` is exported so the admin form can offer these as a picker rather
 * than a free-text box, which stops the mismatch at the point of entry.
 */
const iconMap = {
  // General
  zap: Zap, star: Star, sparkles: Sparkles, target: Target, rocket: Rocket,
  check: Check, 'check-circle': CheckCircle, 'x-circle': XCircle,
  'alert-circle': AlertCircle, info: Info, eye: Eye, flame: Flame,
  compass: Compass, tag: Tag, tags: Tags, bell: Bell, scale: Scale,
  // Infrastructure
  server: Server, cpu: Cpu, microchip: Microchip, 'circuit-board': CircuitBoard,
  'memory-stick': MemoryStick, 'hard-drive': HardDrive, database: Database,
  cloud: Cloud, 'cloud-cog': CloudCog, container: Container, box: Box,
  boxes: Boxes, layers: Layers, package: Package, network: Network,
  globe: Globe, wifi: Wifi, plug: Plug, waypoints: Waypoints, split: Split,
  // Security
  shield: Shield, 'shield-check': ShieldCheck, lock: Lock, unlock: Unlock,
  key: Key, fingerprint: Fingerprint,
  // Developer
  terminal: Terminal, code: Code, 'code-2': Code2, braces: Braces,
  'git-branch': GitBranch, workflow: Workflow, bot: Bot, brain: Brain,
  // Metrics
  'bar-chart': BarChart3, 'line-chart': LineChart, 'pie-chart': PieChart,
  activity: Activity, gauge: Gauge, 'trending-up': TrendingUp,
  'trending-down': TrendingDown,
  // Money
  'credit-card': CreditCard, wallet: Wallet, 'dollar-sign': DollarSign,
  calculator: Calculator,
  // Time
  clock: Clock, timer: Timer, calendar: Calendar, infinity: InfinityIcon,
  // Actions
  upload: Upload, download: Download, search: Search, filter: Filter,
  settings: Settings, sliders: SlidersHorizontal, play: Play, pause: Pause,
  'refresh-cw': RefreshCw, repeat: Repeat, send: Send,
  'arrow-right': ArrowRight, 'arrow-up-right': ArrowUpRight,
  'chevron-right': ChevronRight,
  // Content & contact
  image: Image, 'file-text': FileText, 'book-open': BookOpen,
  mail: Mail, message: MessageCircle, 'message-square': MessageSquare,
  phone: Phone, map: MapPin, users: Users, user: User,
  headphones: Headphones, 'life-buoy': LifeBuoy, building: Building2,
};

/** Sorted icon names, for the admin center's icon picker. */
export const ICON_NAMES = Object.keys(iconMap).sort();

/**
 * Resolve an admin-entered icon name to an element.
 * Emoji pass through as-is; unknown names degrade to a neutral mark.
 */
export const getIcon = (iconName, className = 'w-6 h-6') => {
  if (!iconName) return <Sparkles className={className} />;

  // Emoji (any non-ASCII) is rendered as text on purpose — admins use it often.
  // Checked by code point rather than a regex range, which would need control
  // characters in the pattern.
  const hasNonAscii = Array.from(String(iconName)).some((ch) => ch.codePointAt(0) > 127);
  if (hasNonAscii) {
    return <span className="text-2xl leading-none">{iconName}</span>;
  }

  const key = String(iconName).trim().toLowerCase().replace(/[\s_]+/g, '-');
  const IconComponent = iconMap[key];
  return IconComponent ? <IconComponent className={className} /> : <Sparkles className={className} />;
};

export default getIcon;
