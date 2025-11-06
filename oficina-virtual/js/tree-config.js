export const TREE_CONFIG = {
  DEPTH_LIMIT: 6,
  
  SPACING: {
    minNodeSeparation: 80,
    siblingMultiplier: 1.8,
    cousinMultiplier: 2.2,
    heightMultiplier: 1.5,
  },
  
  NODE_SIZES: {
    rootRadius: 38,
    baseRadius: 36,
    minRadius: 24,
    radiusDecrement: 2,
    hitAreaRadius: 40,
    strokeWidth: 3,
  },
  
  COLORS: {
    rootNode: '#2b9df3',
    activeNode: '#28a745',
    inactiveNode: '#bfbfbf',
    linkStroke: '#d0d0d0',
    nodeStroke: '#ffffff',
    childrenCountColor: '#666',
  },
  
  ANIMATION: {
    duration: 600,
    transitionDuration: 400,
    doubleTapDelay: 300,
  },
  
  LAYOUT: {
    topMargin: 60,
    margin: { top: 20, right: 20, bottom: 20, left: 20 },
    minWidth: 600,
    minHeight: 400,
  },
  
  ZOOM: {
    minScale: 0.4,
    maxScale: 2,
    enabled: true,
  },
  
  FEATURES: {
    collapseExpand: true,
    showChildrenCount: true,
    animatedEntrance: true,
    zoomPan: true,
  },
  
  TEXT: {
    rootFontSize: '14px',
    nodeFontSize: '12px',
    countFontSize: '11px',
    fontWeight: '700',
    maxUsernameLength: 12,
    truncateSuffix: '…',
  }
};

export default TREE_CONFIG;
