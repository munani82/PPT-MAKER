/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Plus, 
  Trash2, 
  Layers, 
  Download, 
  Image as ImageIcon, 
  Eye, 
  EyeOff, 
  Monitor, 
  Smartphone,
  ChevronLeft,
  ChevronRight,
  ClipboardPaste,
  HelpCircle,
  LogIn,
  LogOut,
  RotateCcw,
  CloudCheck,
  Cloud
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import pptxgen from 'pptxgenjs';
import { cn } from './lib/utils';
import { Slide, Layer, LayoutOrientation } from './types';
import { auth, googleProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut, db } from './lib/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, getDoc, setDoc, onSnapshot, serverTimestamp } from 'firebase/firestore';

const A3_WIDTH_IN = 16.54;
const A3_HEIGHT_IN = 11.69;

const DEFAULT_SLIDE = () => ({
  id: crypto.randomUUID(),
  layers: Array.from({ length: 6 }).map((_, i) => ({
    id: crypto.randomUUID(),
    name: `Slot ${i + 1}`,
    type: 'image',
    isVisible: true,
    content: '',
    opacity: 1
  }))
});

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [slides, setSlides] = useState<Slide[]>([DEFAULT_SLIDE()]);
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null);
  const [orientation, setOrientation] = useState<LayoutOrientation>('landscape');
  const [showHelp, setShowHelp] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Auth Handling
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setIsLoadingAuth(false);
    });
    return () => unsubscribe();
  }, []);

  // Firestore Sync - Loading
  useEffect(() => {
    if (!user) return;

    const docRef = doc(db, 'userStates', user.uid);
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists() && !isSaving) {
        const data = docSnap.data();
        if (data.slides) setSlides(data.slides);
        if (data.orientation) setOrientation(data.orientation);
      }
    });

    return () => unsubscribe();
  }, [user, isSaving]);

  // Firestore Sync - Saving (Debounced)
  useEffect(() => {
    if (!user || isLoadingAuth) return;

    const saveTimeout = setTimeout(async () => {
      setIsSaving(true);
      try {
        await setDoc(doc(db, 'userStates', user.uid), {
          userId: user.uid,
          slides,
          orientation,
          updatedAt: serverTimestamp()
        }, { merge: true });
      } catch (e) {
        console.error("Save failed:", e);
      } finally {
        setIsSaving(false);
      }
    }, 2000); // Save after 2s of inactivity

    return () => clearTimeout(saveTimeout);
  }, [slides, orientation, user, isLoadingAuth]);

  const resetProject = () => {
    if (confirm("모든 작업 내용이 사라집니다. 정말 초기화하시겠습니까?")) {
      setSlides([DEFAULT_SLIDE()]);
      setOrientation('landscape');
      setActiveSlideIndex(0);
      setActiveLayerId(null);
    }
  };

  const activeSlide = slides[activeSlideIndex];

  const addLayer = () => {
    const newLayer: Layer = {
      id: crypto.randomUUID(),
      name: `Layer ${activeSlide.layers.length + 1}`,
      type: 'image',
      isVisible: true,
      content: '',
      opacity: 1
    };
    updateSlideLayers(activeSlide.id, [...activeSlide.layers, newLayer]);
    setActiveLayerId(newLayer.id);
  };

  const deleteLayer = (layerId: string) => {
    if (activeSlide.layers.length <= 1) return;
    const newLayers = activeSlide.layers.filter(l => l.id !== layerId);
    updateSlideLayers(activeSlide.id, newLayers);
    if (activeLayerId === layerId) {
      setActiveLayerId(newLayers[0].id);
    }
  };

  const updateSlideLayers = (slideId: string, layers: Layer[]) => {
    setSlides(prev => prev.map(s => s.id === slideId ? { ...s, layers } : s));
  };
  useEffect(() => {
    if (activeSlide && !activeLayerId) {
      setActiveLayerId(activeSlide.layers[0].id);
    }
  }, [activeSlide, activeLayerId]);

  const addSlide = () => {
    const newSlide: Slide = {
      id: crypto.randomUUID(),
      layers: Array.from({ length: 6 }).map((_, i) => ({
        id: crypto.randomUUID(),
        name: `Slot ${i + 1}`,
        type: 'image',
        isVisible: true,
        content: '',
        opacity: 1
      }))
    };
    setSlides([...slides, newSlide]);
    setActiveSlideIndex(slides.length);
    setActiveLayerId(newSlide.layers[0].id);
  };

  const deleteSlide = (index: number) => {
    if (slides.length <= 1) return;
    const newSlides = slides.filter((_, i) => i !== index);
    setSlides(newSlides);
    if (activeSlideIndex >= index) {
      setActiveSlideIndex(Math.max(0, activeSlideIndex - 1));
    }
  };

  const updateLayer = (slideId: string, layerId: string, updates: Partial<Layer>) => {
    setSlides(prev => prev.map(s => {
      if (s.id !== slideId) return s;
      return {
        ...s,
        layers: s.layers.map(l => l.id === layerId ? { ...l, ...updates } : l)
      };
    }));
  };

  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchAndConvertToBase64 = async (url: string) => {
    if (!url.startsWith('http')) return url;
    try {
      const response = await fetch(`/api/proxy-image?url=${encodeURIComponent(url)}`);
      if (!response.ok) throw new Error("Proxy fetch failed");
      const blob = await response.blob();
      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch (e) {
      console.error("Failed to fetch through proxy:", e);
      return url; // fallback to original url
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeLayerId) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      updateLayer(activeSlide.id, activeLayerId, { content });
    };
    reader.readAsDataURL(file);
    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleClipboardRead = async () => {
    if (!activeLayerId) return;
    try {
      // One single call to read to prevent multiple popups on iOS
      const items = await navigator.clipboard.read();
      let foundContent = false;
      
      for (const item of items) {
        // 1. Try to find Image Data first
        const imageType = item.types.find(type => type.startsWith('image/'));
        if (imageType) {
          const blob = await item.getType(imageType);
          const reader = new FileReader();
          reader.onload = (event) => {
            const content = event.target?.result as string;
            updateLayer(activeSlide.id, activeLayerId, { content });
          };
          reader.readAsDataURL(blob);
          foundContent = true;
          break;
        }

        // 2. Fallback: Check if there's plain text that might be a Data URL or Image Link
        const textType = item.types.find(type => type === 'text/plain');
        if (textType) {
          const blob = await item.getType(textType);
          const text = await blob.text();
          if (text && text.startsWith('data:image/')) {
            updateLayer(activeSlide.id, activeLayerId, { content: text });
            foundContent = true;
            break;
          } else if (text && text.startsWith('http')) {
            // Use proxy to get base64 immediately for better reliability
            const base64 = await fetchAndConvertToBase64(text);
            updateLayer(activeSlide.id, activeLayerId, { content: base64 });
            foundContent = true;
            break;
          }
        }
      }
      
      if (!foundContent) {
        alert('이미지를 찾을 수 없습니다. 이미지를 복사(Copy)한 후 다시 시도해주세요.');
      }
    } catch (err: any) {
      console.error('Clipboard access error:', err);
      if (err.name === 'NotAllowedError') {
        alert('클립보드 접근 권한이 거부되었습니다. 주소창 옆의 권한 설정을 확인해주세요.');
      } else {
        alert('브라우저 보안 설정으로 인해 직접 붙여넣기가 제한되었습니다. Ctrl+V(또는 Cmd+V)를 사용해보세요.');
      }
    }
  };

  const clearSlotContent = (layerId: string) => {
    updateLayer(activeSlide.id, layerId, { content: '' });
  };

  const handlePaste = useCallback((e: ClipboardEvent) => {
    if (!activeLayerId) return;

    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const blob = items[i].getAsFile();
        if (!blob) continue;

        const reader = new FileReader();
        reader.onload = (event) => {
          const content = event.target?.result as string;
          updateLayer(activeSlide.id, activeLayerId, { content });
        };
        reader.readAsDataURL(blob);
        break;
      }
    }
  }, [activeSlide, activeLayerId]);

  useEffect(() => {
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [handlePaste]);

  const exportToPPTX = async () => {
    setIsExporting(true);
    try {
      const pres = new pptxgen();
      
      const width = orientation === 'landscape' ? A3_WIDTH_IN : A3_HEIGHT_IN;
      const height = orientation === 'landscape' ? A3_HEIGHT_IN : A3_WIDTH_IN;

      pres.defineLayout({ name: 'A3', width, height });
      pres.layout = 'A3';

      for (const slide of slides) {
        const pptSlide = pres.addSlide();
        
        const cols = 3;
        const rows = 2;
        const gutter = 0;
        const slotW = width / cols;
        const slotH = height / rows;

        for (const layer of slide.layers) {
          if (layer.isVisible && layer.content) {
            const i = slide.layers.indexOf(layer);
            const col = i % cols;
            const row = Math.floor(i / cols);
            
            const isUrl = layer.content.startsWith('http');
            const commonProps = {
              x: col * slotW,
              y: row * slotH,
              w: slotW,
              h: slotH,
              sizing: { type: 'contain' as const, w: slotW, h: slotH }
            };

            if (isUrl) {
              const base64 = await fetchAndConvertToBase64(layer.content);
              if (base64.startsWith('data:')) {
                const cleanData = base64.replace(/^data:/, '');
                pptSlide.addImage({ ...commonProps, data: cleanData });
              } else {
                // Fallback to path if proxy failed, though it will likely hit CORS
                pptSlide.addImage({ ...commonProps, path: layer.content });
              }
            } else {
              // pptxgenjs expects the base64 string to start with "image/[ext];base64," (NO "data:" prefix)
              const cleanData = layer.content.startsWith('data:') 
                ? layer.content.replace(/^data:/, '') 
                : layer.content;
              pptSlide.addImage({ ...commonProps, data: cleanData });
            }
          }
        }
      }

      await pres.writeFile({ fileName: `Worship_Flow_Grid_${new Date().toISOString().split('T')[0]}.pptx` });
    } catch (error) {
      console.error('Export failed:', error);
    } finally {
      setIsExporting(false);
    }
  };

  const handleLogin = async (e: React.MouseEvent) => {
    e.preventDefault();
    setAuthError(null);
    setIsLoggingIn(true);
    
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error: any) {
      if (error.code === 'auth/popup-blocked') {
        setAuthError("브라우저가 로그인 창을 차단했습니다. 주소창 옆의 차단 해제 설정을 확인해주세요.");
      } else if (error.code === 'auth/unauthorized-domain') {
        setAuthError("허용되지 않은 도메인입니다. Firebase 콘솔 설정을 확인해주세요.");
      } else if (error.code !== 'auth/popup-closed-by-user') {
        setAuthError(`로그인 오류: ${error.code}`);
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    window.location.reload();
  };

  return (
    <div className="flex h-screen w-full flex-col bg-[#F5F5F7] font-sans text-neutral-900 selection:bg-blue-100">
      {/* Top Bar */}
      <header className="flex h-14 items-center justify-between border-b border-[#E5E5E5] bg-white px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded bg-black">
            <div className="h-4 w-4 border-2 border-white" />
          </div>
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-bold tracking-tight text-neutral-900">문환's 콘티 메이커</h1>
            <span className="rounded-full bg-[#E0F2FE] px-3 py-0.5 text-[11px] font-semibold text-[#0369A1]">
              A3 {orientation === 'landscape' ? 'Horizontal' : 'Vertical'} Mode
            </span>
            {user && (
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-neutral-50 border border-neutral-100">
                {isSaving ? (
                  <Cloud className="h-3 w-3 text-neutral-400 animate-pulse" />
                ) : (
                  <CloudCheck className="h-3 w-3 text-green-500" />
                )}
                <span className="text-[10px] font-medium text-neutral-500 uppercase tracking-tighter">
                  {isSaving ? 'Syncing...' : 'Saved to Cloud'}
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-4">
          {authError && (
            <div className="animate-in fade-in slide-in-from-top-1 flex flex-col gap-1 rounded-md bg-red-50 p-2 shadow-sm border border-red-100 max-w-[200px]">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-1.5 text-[10px] font-bold text-red-600 uppercase">
                  <HelpCircle className="h-3 w-3" />
                  Auth Issue
                </div>
                <button onClick={() => setAuthError(null)} className="text-red-400 hover:text-red-700">×</button>
              </div>
              <p className="text-[10px] leading-tight text-red-500">
                {authError === 'POPUP_BLOCKED' ? "브라우저 차단으로 로그인 창이 열리지 않았습니다." : 
                 authError === 'UNAUTHORIZED_DOMAIN' ? "Firebase 콘솔에 현재 도메인이 등록되지 않았습니다." : authError}
              </p>
              {authError === 'UNAUTHORIZED_DOMAIN' && (
                <div className="mt-1 flex flex-col gap-1">
                  <p className="text-[8px] text-neutral-500 break-all bg-white p-1 rounded border border-red-100">
                    ppt-maker-phi.vercel.app
                  </p>
                  <p className="text-[8px] font-bold text-red-400">위 주소를 Firebase 승인된 도메인에 추가해주세요.</p>
                </div>
              )}
            </div>
          )}

          {!isLoadingAuth && (
            user ? (
              <div className="flex items-center gap-3 pr-4 border-r border-neutral-200">
                <div className="flex flex-col items-end">
                  <span className="text-[11px] font-bold text-neutral-700">{user.displayName}</span>
                  <button onClick={handleLogout} className="text-[9px] font-bold text-neutral-400 hover:text-red-500 uppercase tracking-wider">Logout</button>
                </div>
                {user.photoURL && <img src={user.photoURL} className="h-8 w-8 rounded-full border border-neutral-200" alt="avatar" />}
              </div>
            ) : (
              <button 
                onClick={handleLogin}
                disabled={isLoggingIn}
                className="flex items-center gap-2 rounded-full bg-blue-600 px-4 py-1.5 text-[11px] font-bold text-white shadow-sm transition-all hover:bg-blue-700 active:scale-95 disabled:opacity-50"
              >
                {isLoggingIn ? <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" /> : <LogIn className="h-3.5 w-3.5" />}
                Google Login
              </button>
            )
          )}

          <div className="flex items-center rounded bg-neutral-100 p-1 ring-1 ring-neutral-200">
            <button 
              onClick={() => setOrientation('landscape')}
              className={cn(
                "flex h-7 items-center gap-2 rounded px-3 text-[11px] font-semibold uppercase transition-all",
                orientation === 'landscape' ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-700"
              )}
            >
              <Monitor className="h-3.5 w-3.5" />
              Landscape
            </button>
            <button 
              onClick={() => setOrientation('portrait')}
              className={cn(
                "flex h-7 items-center gap-2 rounded px-3 text-[11px] font-semibold uppercase transition-all",
                orientation === 'portrait' ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-700"
              )}
            >
              <Smartphone className="h-3.5 w-3.5" />
              Portrait
            </button>
          </div>

          <div className="h-6 w-px bg-neutral-200" />

          <button 
            onClick={() => setShowHelp(true)}
            className="flex h-9 w-9 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
          >
            <HelpCircle className="h-5 w-5" />
          </button>

          <button 
            onClick={resetProject}
            className="flex h-9 items-center gap-2 rounded border border-neutral-200 bg-white px-4 text-[13px] font-medium text-neutral-500 transition-all hover:bg-neutral-50 hover:text-neutral-800"
          >
            <RotateCcw className="h-4 w-4" />
            Reset
          </button>

          <button 
            onClick={exportToPPTX}
            disabled={isExporting}
            className="flex h-9 items-center gap-2 rounded bg-[#1A1A1B] px-5 text-[13px] font-medium text-white transition-all hover:bg-black active:scale-95 disabled:opacity-50"
          >
            {isExporting ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> : <Download className="h-4 w-4" />}
            Export to PPTX
          </button>
        </div>
      </header>

      <main className="flex flex-1 overflow-hidden">
        {/* Left Sidebar: Layers */}
        <aside className="w-[260px] border-r border-[#E5E5E5] bg-white flex flex-col">
          <div className="p-4 border-b border-neutral-100">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">Layer Hierarchy</h2>
          </div>
          
          <div className="flex-1 overflow-y-auto pt-2 pb-2">
            {activeSlide?.layers.map((layer) => (
              <div 
                key={layer.id}
                onClick={() => setActiveLayerId(layer.id)}
                className={cn(
                  "group relative flex cursor-pointer items-center gap-3 border-b border-[#F0F0F0] px-4 py-3 transition-all",
                  activeLayerId === layer.id 
                    ? "bg-[#EFF6FF] border-l-4 border-l-[#3B82F6]" 
                    : "hover:bg-neutral-50 border-l-4 border-l-transparent"
                )}
              >
                <div className={cn(
                  "flex h-7 w-10 shrink-0 items-center justify-center rounded bg-neutral-200 overflow-hidden",
                  activeLayerId === layer.id ? "ring-1 ring-[#3B82F6]/30" : ""
                )}>
                  {layer.content ? (
                    <img src={layer.content} className="h-full w-full object-contain" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="h-full w-full bg-[#DDD]" />
                  )}
                </div>
                <div className="flex-1 overflow-hidden">
                  <p className={cn(
                    "truncate text-[13px] font-medium",
                    activeLayerId === layer.id ? "text-[#3B82F6]" : "text-neutral-700"
                  )}>
                    {layer.name}
                  </p>
                  <p className="text-[10px] text-neutral-400">
                    {layer.content ? 'Image Ready' : 'Empty Layer'}
                  </p>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      updateLayer(activeSlide.id, layer.id, { isVisible: !layer.isVisible });
                    }}
                    className="p-1 text-neutral-400 hover:text-neutral-600"
                  >
                    {layer.isVisible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                  </button>
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteLayer(layer.id);
                    }}
                    className="p-1 text-neutral-400 hover:text-red-500"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
            
            <button 
              onClick={addLayer}
              className="mt-4 mx-4 flex items-center justify-center gap-2 rounded border-1.5 border-dashed border-neutral-300 py-3 text-[12px] font-medium text-neutral-400 transition-all hover:border-[#3B82F6] hover:text-[#3B82F6] hover:bg-blue-50"
            >
              <Plus className="h-4 w-4" />
              Add New Layer
            </button>
          </div>

          <div className="p-4 bg-neutral-50 border-t border-neutral-100">
            <div className="flex items-center gap-2 mb-2">
              <ClipboardPaste className="h-3.5 w-3.5 text-neutral-400" />
              <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Pro Tip</span>
            </div>
            <p className="text-[11px] leading-relaxed text-neutral-600">
              Press <kbd className="bg-white border border-neutral-200 px-1 rounded shadow-sm text-[9px]">Ctrl</kbd> + <kbd className="bg-white border border-neutral-200 px-1 rounded shadow-sm text-[9px]">V</kbd> to automatically place onto the selected layer slot.
            </p>
          </div>
        </aside>

        {/* Center Canvas */}
        <section className="relative flex flex-1 flex-col items-center justify-center bg-[#EAEAEA] p-12">
          {/* Canvas Wrapper */}
          <div 
            className={cn(
              "relative bg-white shadow-[0_10px_30px_rgba(0,0,0,0.1)] transition-all duration-500 ease-in-out overflow-hidden ring-1 ring-neutral-200",
              orientation === 'landscape' ? "aspect-[1.414/1] h-full max-h-[80%]" : "aspect-[1/1.414] h-full max-h-[90%]"
            )}
          >
            {/* Grid Layout Canvas */}
            <div className="absolute inset-0 grid grid-cols-3 grid-rows-2">
              {activeSlide?.layers.map((layer, i) => (
                <div 
                  key={layer.id}
                  onClick={() => setActiveLayerId(layer.id)}
                  className={cn(
                    "relative flex flex-col items-center justify-center rounded transition-all cursor-pointer overflow-hidden",
                    activeLayerId === layer.id 
                      ? "ring-2 ring-[#3B82F6] bg-[#EFF6FF] border-transparent" 
                      : "border border-dashed border-[#CCC] bg-[#F9F9F9] hover:bg-neutral-100"
                  )}
                >
                  <AnimatePresence>
                    {layer.isVisible && layer.content ? (
                      <motion.img 
                        initial={{ opacity: 0 }}
                        animate={{ opacity: layer.opacity }}
                        exit={{ opacity: 0 }}
                        src={layer.content}
                        className="absolute inset-0 h-full w-full object-contain"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="flex flex-col items-center text-neutral-400">
                        <ImageIcon className="mb-1 h-4 w-4 opacity-40" />
                        <span className="text-[9px] font-bold uppercase tracking-tighter">Slot {i + 1}</span>
                      </div>
                    )}
                  </AnimatePresence>
                  
                  {activeLayerId === layer.id && (
                    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-white/70 backdrop-blur-[2px]">
                      {layer.content ? (
                         <div className="flex flex-col items-center gap-3">
                            <div className="flex gap-2">
                              <button 
                                onClick={(e) => { e.stopPropagation(); handleClipboardRead(); }}
                                className="flex h-8 w-8 items-center justify-center rounded-full bg-[#1A1A1B] text-white shadow-lg transition-transform active:scale-95"
                                title="Replace from Clipboard"
                              >
                                <ClipboardPaste className="h-3.5 w-3.5" />
                              </button>
                              <button 
                                onClick={(e) => { e.stopPropagation(); clearSlotContent(layer.id); }}
                                className="flex h-8 w-8 items-center justify-center rounded-full bg-red-500 text-white shadow-lg transition-transform active:scale-95"
                                title="Clear Image"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                            <div className="w-24 space-y-1">
                               <p className="text-[9px] font-bold text-neutral-500 uppercase text-center">Opacity</p>
                               <input 
                                 type="range" 
                                 min="0.1" 
                                 max="1" 
                                 step="0.05" 
                                 value={layer.opacity}
                                 onChange={(e) => {
                                   e.stopPropagation();
                                   updateLayer(activeSlide.id, layer.id, { opacity: parseFloat(e.target.value) });
                                 }}
                                 className="h-1 w-full cursor-pointer appearance-none rounded-lg bg-neutral-200 accent-[#3B82F6]"
                                 onClick={e => e.stopPropagation()}
                               />
                            </div>
                         </div>
                      ) : (
                        <>
                          <button 
                            onClick={(e) => { e.stopPropagation(); handleClipboardRead(); }}
                            className="flex items-center gap-2 rounded bg-[#3B82F6] px-3 py-1.5 text-[10px] font-bold text-white shadow-lg transition-transform active:scale-95"
                          >
                            <ClipboardPaste className="h-3 w-3" />
                            Paste Image
                          </button>
                          <button 
                            onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                            className="flex items-center gap-2 rounded bg-white px-3 py-1.5 text-[10px] font-bold text-neutral-700 shadow-sm ring-1 ring-neutral-200 transition-transform active:scale-95"
                          >
                            <ImageIcon className="h-3 w-3" />
                            Library
                          </button>
                        </>
                      )}
                    </div>
                  )}
                  
                  {activeLayerId === layer.id && !layer.content && (
                    <div className="absolute top-1 right-1 z-10 rounded-full bg-[#3B82F6] p-0.5 shadow-sm">
                      <div className="h-1.5 w-1.5 rounded-full bg-white" />
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Document Label */}
            <div className="absolute -bottom-10 left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] font-medium tracking-[0.2em] uppercase text-neutral-400">
              Document Size: 420 x 297 mm (A3)
            </div>
          </div>

          {/* Navigation Controls */}
          <div className="mt-14 flex items-center gap-6">
            <button 
              onClick={() => setActiveSlideIndex(prev => Math.max(0, prev - 1))}
              disabled={activeSlideIndex === 0}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-neutral-300 bg-white text-neutral-500 shadow-sm transition-all hover:bg-neutral-50 hover:text-neutral-800 disabled:opacity-30"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-xs font-bold tracking-widest text-neutral-500 bg-white px-3 py-1 rounded-full border border-neutral-200">
              SLIDE {activeSlideIndex + 1} <span className="mx-2 opacity-30">/</span> {slides.length}
            </span>
            <button 
              onClick={() => setActiveSlideIndex(prev => Math.min(slides.length - 1, prev + 1))}
              disabled={activeSlideIndex === slides.length - 1}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-neutral-300 bg-white text-neutral-500 shadow-sm transition-all hover:bg-neutral-50 hover:text-neutral-800 disabled:opacity-30"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </section>

        {/* Right Sidebar: Slides Timeline */}
        <aside className="w-[200px] border-l border-[#E5E5E5] bg-white flex flex-col">
          <div className="p-4 border-b border-neutral-100 flex items-center justify-between">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">Timeline</h2>
            <button 
              onClick={addSlide}
              className="flex h-6 w-6 items-center justify-center rounded bg-neutral-100 text-neutral-600 hover:bg-[#1A1A1B] hover:text-white transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="p-3 space-y-4 flex-1 overflow-y-auto custom-scrollbar">
            {slides.map((slide, index) => (
              <div key={slide.id} className="group relative">
                <div 
                  onClick={() => setActiveSlideIndex(index)}
                  className={cn(
                    "relative aspect-[1.414/1] cursor-pointer rounded border bg-neutral-50 overflow-hidden transition-all",
                    activeSlideIndex === index ? "border-[#3B82F6] ring-2 ring-[#3B82F6]/10" : "border-neutral-200 hover:border-neutral-400"
                  )}
                >
                  {/* Mini Grid Preview */}
                  <div className="absolute inset-0 grid grid-cols-3 grid-rows-2">
                    {slide.layers.map((l) => (
                      <div key={l.id} className="relative h-full w-full border-[0.5px] border-neutral-200/30 overflow-hidden bg-white/40">
                        {l.content && (
                          <img 
                            src={l.content} 
                            className="h-full w-full object-contain" 
                            referrerPolicy="no-referrer" 
                            style={{ opacity: l.opacity }}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="absolute bottom-1 right-1 px-1 rounded bg-black/20 backdrop-blur-[2px]">
                    <span className="text-[8px] font-bold text-white uppercase tracking-tighter">Slide {index + 1}</span>
                  </div>
                </div>
                {slides.length > 1 && (
                  <button 
                    onClick={() => deleteSlide(index)}
                    className="absolute -top-1 -right-1 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white shadow-md transition-all hover:bg-red-600 scale-100"
                  >
                    <Trash2 className="h-2.5 w-2.5" />
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className="p-4 bg-neutral-50 border-t border-neutral-100">
             <div className="p-3 rounded bg-white border border-neutral-200 shadow-sm">
                <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 mb-1 block">Automation</label>
                <div className="text-[11px] font-bold text-neutral-700">Auto-Fill Sequential</div>
             </div>
          </div>
        </aside>
      </main>

      {/* Help Modal */}
      <AnimatePresence>
        {showHelp && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-6"
            onClick={() => setShowHelp(false)}
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-md rounded-2xl bg-neutral-100 p-8 shadow-2xl ring-1 ring-neutral-200 text-neutral-900"
              onClick={e => e.stopPropagation()}
            >
              <h3 className="mb-6 font-serif text-3xl italic tracking-tight underline decoration-neutral-300 underline-offset-8 text-center">Workflow Guide</h3>
              
              <ul className="space-y-6">
                <li className="flex items-start gap-4">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-[10px] font-bold text-neutral-100">01</div>
                  <div>
                    <p className="text-sm font-bold">Copy your Image</p>
                    <p className="text-xs text-neutral-500 mt-1">Found a lyric sheet or background? Copy it to your clipboard (Ctrl+C).</p>
                  </div>
                </li>
                <li className="flex items-start gap-4">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-[10px] font-bold text-neutral-100">02</div>
                  <div>
                    <p className="text-sm font-bold">Select Layer</p>
                    <p className="text-xs text-neutral-500 mt-1">Click on 'Background' or 'Content' in the left panel to target it.</p>
                  </div>
                </li>
                <li className="flex items-start gap-4">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-[10px] font-bold text-neutral-100">03</div>
                  <div>
                    <p className="text-sm font-bold">Press Ctrl+V</p>
                    <p className="text-xs text-neutral-500 mt-1">Simply paste anywhere. The active layer will instantly update with your image.</p>
                  </div>
                </li>
                <li className="flex items-start gap-4">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-[10px] font-bold text-neutral-100">04</div>
                  <div>
                    <p className="text-sm font-bold">Export A3 PPTX</p>
                    <p className="text-xs text-neutral-500 mt-1">When done, hit the export button to get a high-quality PowerPoint file.</p>
                  </div>
                </li>
              </ul>

              <button 
                onClick={() => setShowHelp(false)}
                className="mt-8 w-full rounded-xl bg-neutral-900 py-3 text-xs font-bold text-neutral-100 transition-all hover:bg-black"
              >
                Got it
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #262626;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #404040;
        }
      `}</style>

      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleFileUpload} 
        accept="image/*" 
        className="hidden" 
      />

      {/* Footer / Status */}
      <footer className="flex h-6 items-center justify-between border-t border-neutral-800 bg-neutral-900 px-6 font-mono text-[9px] uppercase tracking-wider text-neutral-600">
        <div className="flex items-center gap-4">
          <span>Engine: PPTXGENJS</span>
          <span className="opacity-30">|</span>
          <span>Buffer: Local-Only</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
          <span>System Ready</span>
        </div>
      </footer>
    </div>
  );
}
