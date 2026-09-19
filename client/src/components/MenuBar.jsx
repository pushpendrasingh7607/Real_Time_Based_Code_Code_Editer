/**
 * MenuBar.jsx — VS Code-style top menu bar
 *
 * Provides: File menu, View menu, Edit menu (keyboard shortcuts shown)
 * Handles: Ctrl+N, Ctrl+O, Ctrl+S, Ctrl+Shift+P, Ctrl+Shift+E
 *
 * Security: No innerHTML. All labels via JSX text. onClick handlers only.
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';

const MENUS = ['File', 'View'];

function MenuItem({ item, onClose }) {
  if (item.separator) return <div className="menu-separator" role="separator" />;

  return (
    <button
      className={`menu-item ${item.disabled ? 'menu-item-disabled' : ''}`}
      onClick={() => {
        if (!item.disabled && item.action) {
          item.action();
          onClose();
        }
      }}
      disabled={item.disabled}
      role="menuitem"
      tabIndex={item.disabled ? -1 : 0}
    >
      <span className="menu-item-icon" aria-hidden="true">{item.icon ?? ''}</span>
      <span className="menu-item-label">{item.label}</span>
      {item.shortcut && (
        <span className="menu-item-shortcut" aria-label={`Keyboard shortcut: ${item.shortcut}`}>
          {item.shortcut}
        </span>
      )}
    </button>
  );
}

function DropdownMenu({ label, items, isOpen, onOpen, onClose }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen, onClose]);

  return (
    <div className="menu-entry" ref={ref}>
      <button
        className={`menu-entry-btn ${isOpen ? 'menu-entry-open' : ''}`}
        onClick={() => (isOpen ? onClose() : onOpen())}
        aria-haspopup="menu"
        aria-expanded={isOpen}
      >
        {label}
      </button>
      {isOpen && (
        <div className="menu-dropdown" role="menu" aria-label={`${label} menu`}>
          {items.map((item, i) =>
            item.separator ? (
              <div key={`sep-${i}`} className="menu-separator" role="separator" />
            ) : (
              <MenuItem key={item.label} item={item} onClose={onClose} />
            )
          )}
        </div>
      )}
    </div>
  );
}

function MenuBar({
  activeFile,
  onNewFile,
  onOpenFile,
  onOpenFolder,
  onSave,
  onCloseFile,
  onLeave,
  onToggleExplorer,
  onToggleOutput,
  onTogglePreview,
  onCommandPalette,
  canPreview,
  outputVisible,
  previewVisible,
  explorerOpen,
}) {
  const [openMenu, setOpenMenu] = useState(null); // 'File' | 'View' | null

  const open = useCallback((name) => setOpenMenu(name), []);
  const close = useCallback(() => setOpenMenu(null), []);

  // Close on Escape
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [close]);

  const fileItems = [
    { icon: '📄', label: 'New File', shortcut: 'Ctrl+N', action: onNewFile },
    { separator: true },
    { icon: '📂', label: 'Open File…', shortcut: 'Ctrl+O', action: onOpenFile },
    { icon: '🗂️', label: 'Open Folder…', shortcut: 'Ctrl+Shift+O', action: onOpenFolder },
    { separator: true },
    {
      icon: '💾', label: 'Save', shortcut: 'Ctrl+S',
      action: onSave, disabled: !activeFile,
    },
    { separator: true },
    {
      icon: '✕', label: 'Close File',
      action: onCloseFile, disabled: !activeFile,
    },
    { separator: true },
    { icon: '🚪', label: 'Leave Room', action: onLeave },
  ];

  const viewItems = [
    {
      icon: '⌨️', label: 'Command Palette',
      shortcut: 'Ctrl+Shift+P', action: onCommandPalette,
    },
    { separator: true },
    {
      icon: explorerOpen ? '✓' : '  ',
      label: 'Explorer',
      shortcut: 'Ctrl+Shift+E',
      action: onToggleExplorer,
    },
    {
      icon: outputVisible ? '✓' : '  ',
      label: 'Output Panel',
      action: onToggleOutput,
    },
    {
      icon: previewVisible ? '✓' : '  ',
      label: 'Preview',
      action: onTogglePreview,
      disabled: !canPreview,
    },
  ];

  return (
    <div className="menu-bar" role="menubar" aria-label="Application menu">
      <DropdownMenu
        label="File"
        items={fileItems}
        isOpen={openMenu === 'File'}
        onOpen={() => open('File')}
        onClose={close}
      />
      <DropdownMenu
        label="View"
        items={viewItems}
        isOpen={openMenu === 'View'}
        onOpen={() => open('View')}
        onClose={close}
      />

      {/* Breadcrumb-style path indicator */}
      {activeFile && (
        <div className="menu-bar-breadcrumb" aria-label="Current file path">
          <span className="breadcrumb-path">{activeFile.path}</span>
        </div>
      )}
    </div>
  );
}

export default MenuBar;
