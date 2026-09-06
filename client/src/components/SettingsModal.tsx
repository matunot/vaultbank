import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, User, Bell, Shield, Sun, Moon, LogOut,
  Check, Eye, EyeOff, Download, Trash2, Monitor, Smartphone,
  Fingerprint, Key, Mail, Phone, Calendar, Camera,
  Save,
} from 'lucide-react';
import { api } from '../api';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLogout: () => void;
  theme: 'obsidian' | 'royal' | 'diamond';
  onThemeChange: (theme: 'obsidian' | 'royal' | 'diamond') => void;
}

type SettingsTab = 'profile' | 'appearance' | 'security' | 'notifications' | 'advanced';

export default function SettingsModal({ isOpen, onClose, onLogout, theme, onThemeChange }: SettingsModalProps) {
  const [tab, setTab] = useState<SettingsTab>('profile');
  const [saved, setSaved] = useState(false);
  const currentUser = api.getUser();
  const currentAccount = api.getAccount();
  const [name, setName] = useState(currentUser?.full_name || currentUser?.fullName || 'Guest');
  const [email, setEmail] = useState(currentUser?.email || '');
  const [phone, setPhone] = useState(currentUser?.phone || '');
  const accountNumber = currentAccount?.accountNumber || '';

  // Appearance
  const [fontSize, setFontSize] = useState('medium');
  const [sidebarStyle, setSidebarStyle] = useState('glass');
  const [animations, setAnimations] = useState(true);
  const [compactMode, setCompactMode] = useState(false);

  // Security
  const [twoFactor, setTwoFactor] = useState(true);
  const [bioLock, setBioLock] = useState(true);
  const [sessionTimeout, setSessionTimeout] = useState('15');
  const [showPin, setShowPin] = useState(false);
  const [pin, setPin] = useState('');

  // Notifications
  const [pushNotifs, setPushNotifs] = useState(true);
  const [emailNotifs, setEmailNotifs] = useState(true);
  const [smsNotifs, setSmsNotifs] = useState(false);
  const [largeTxAlert, setLargeTxAlert] = useState('10000');
  const [weeklyReport, setWeeklyReport] = useState(true);
  const [monthlyStatement, setMonthlyStatement] = useState(true);

  // Advanced
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const tabs = [
    { id: 'profile' as SettingsTab, icon: User, label: 'Profile' },
    { id: 'appearance' as SettingsTab, icon: Sun, label: 'Appearance' },
    { id: 'security' as SettingsTab, icon: Shield, label: 'Security' },
    { id: 'notifications' as SettingsTab, icon: Bell, label: 'Notifications' },
  ];

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-xl p-4"
        >
          <motion.div
            initial={{ scale: 0.92, y: 30, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.92, y: 30, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 250, damping: 25 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-3xl max-h-[90vh] rounded-3xl glass-panel overflow-hidden flex flex-col"
          >
            {/* Header */}
            <div className="p-6 border-b border-white/10 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/20 flex items-center justify-center">
                  <Shield className="w-4 h-4 text-amber-400" />
                </div>
                <div>
                  <h3 className="font-display text-xl text-white">Settings</h3>
                  <p className="text-xs text-white/40">Manage your account preferences</p>
                </div>
              </div>
              <button onClick={onClose} className="p-2.5 rounded-xl glass-btn hover:bg-white/10">
                <X className="w-4 h-4 text-white/60" />
              </button>
            </div>

            {/* Body */}
            <div className="flex flex-1 overflow-hidden">
              {/* Side tabs */}
              <div className="w-52 border-r border-white/10 p-3 space-y-1 shrink-0 hidden md:block">
                {tabs.map(t => (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-semibold transition-all ${
                      tab === t.id ? 'bg-amber-500/15 text-amber-300 border border-amber-500/20' : 'text-white/50 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    <t.icon className="w-4 h-4" /> {t.label}
                  </button>
                ))}

                <div className="border-t border-white/10 pt-3 mt-3">
                  <button
                    onClick={() => { onClose(); onLogout(); }}
                    className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-semibold text-rose-400/70 hover:text-rose-300 hover:bg-rose-500/10 transition-all"
                  >
                    <LogOut className="w-4 h-4" /> Sign Out
                  </button>
                </div>
              </div>

              {/* Content area */}
              <div className="flex-1 overflow-y-auto p-6">
                {/* Tab: Profile */}
                {tab === 'profile' && (
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                    <h4 className="font-display text-lg text-white mb-4">Profile Information</h4>

                    <div className="flex items-center gap-4 mb-4">
                      <div className="relative">
                        <img src="/avatar.jpg" alt="Profile" className="w-20 h-20 rounded-2xl object-cover ring-2 ring-amber-500/30" />
                        <button className="absolute -bottom-1 -right-1 w-7 h-7 rounded-lg bg-amber-500 text-amber-950 flex items-center justify-center">
                          <Camera className="w-3 h-3" />
                        </button>
                      </div>
                      <div>
                        <p className="font-bold text-white text-lg">{name}</p>
                        <p className="text-xs text-amber-400 font-semibold">Obsidian Member</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] text-white/40 tracking-wider font-semibold mb-2 block">FULL NAME</label>
                        <input value={name} onChange={(e) => setName(e.target.value)} className="w-full glass-input rounded-xl px-4 py-3 text-sm text-white" />
                      </div>
                      <div>
                        <label className="text-[10px] text-white/40 tracking-wider font-semibold mb-2 block">EMAIL</label>
                        <input value={email} onChange={(e) => setEmail(e.target.value)} className="w-full glass-input rounded-xl px-4 py-3 text-sm text-white" />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] text-white/40 tracking-wider font-semibold mb-2 block">PHONE</label>
                        <div className="relative">
                          <Phone className="absolute left-4 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30" />
                          <input value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full glass-input rounded-xl pl-10 pr-4 py-3 text-sm text-white" />
                        </div>
                      </div>
                      <div>
                        <label className="text-[10px] text-white/40 tracking-wider font-semibold mb-2 block">ACCOUNT NUMBER</label>
                        <div className="relative">
                          <Key className="absolute left-4 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30" />
                          <input value={accountNumber} className="w-full glass-input rounded-xl pl-10 pr-4 py-3 text-sm text-white font-mono" disabled />
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}

                {/* Tab: Appearance */}
                {tab === 'appearance' && (
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                    <h4 className="font-display text-lg text-white mb-4">Appearance</h4>

                    <div>
                      <label className="text-[10px] text-white/40 tracking-wider font-semibold mb-3 block">THEME</label>
                      <div className="grid grid-cols-3 gap-3">
                        {[
                          { id: 'obsidian' as const, icon: Moon, label: 'Obsidian', desc: 'Gold noir luxury' },
                          { id: 'royal' as const, icon: Sun, label: 'Royal', desc: 'Blue violet glow' },
                          { id: 'diamond' as const, icon: Monitor, label: 'Diamond', desc: 'Cool crystal night' },
                        ].map(t => (
                          <button
                            key={t.id}
                            onClick={() => onThemeChange(t.id)}
                            className={`p-4 rounded-2xl text-center transition-all ${
                              theme === t.id ? 'bg-amber-500/15 border-2 border-amber-500/40' : 'bg-white/3 border border-white/5'
                            }`}
                          >
                            <t.icon className={`w-5 h-5 mx-auto mb-2 ${theme === t.id ? 'text-amber-400' : 'text-white/40'}`} />
                            <p className="text-sm font-bold text-white">{t.label}</p>
                            <p className="text-[10px] text-white/40">{t.desc}</p>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-[10px] text-white/40 tracking-wider font-semibold mb-2 block">FONT SIZE</label>
                        <select value={fontSize} onChange={(e) => setFontSize(e.target.value)} className="w-full glass-input rounded-xl px-4 py-3 text-sm text-white">
                          <option value="small" className="bg-[#0d0d14]">Small</option>
                          <option value="medium" className="bg-[#0d0d14]">Medium</option>
                          <option value="large" className="bg-[#0d0d14]">Large</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] text-white/40 tracking-wider font-semibold mb-2 block">SIDEBAR STYLE</label>
                        <select value={sidebarStyle} onChange={(e) => setSidebarStyle(e.target.value)} className="w-full glass-input rounded-xl px-4 py-3 text-sm text-white">
                          <option value="glass" className="bg-[#0d0d14]">Frosted Glass</option>
                          <option value="solid" className="bg-[#0d0d14]">Solid</option>
                          <option value="transparent" className="bg-[#0d0d14]">Transparent</option>
                        </select>
                      </div>
                    </div>

                    <div className="space-y-3">
                      {[
                        { label: 'Animations', desc: 'Smooth transitions and effects', value: animations, setter: setAnimations },
                        { label: 'Compact Mode', desc: 'Reduce spacing for density', value: compactMode, setter: setCompactMode },
                      ].map((item, i) => (
                        <div key={i} className="flex items-center justify-between p-3 rounded-xl bg-white/3">
                          <div>
                            <p className="text-sm font-semibold text-white">{item.label}</p>
                            <p className="text-xs text-white/40">{item.desc}</p>
                          </div>
                          <button
                            onClick={() => item.setter(!item.value)}
                            className={`w-12 h-7 rounded-full transition-colors relative ${item.value ? 'bg-amber-500' : 'bg-white/10'}`}
                          >
                            <motion.div
                              animate={{ x: item.value ? 22 : 2 }}
                              className="w-5 h-5 rounded-full bg-white absolute top-1 shadow"
                            />
                          </button>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}

                {/* Tab: Security */}
                {tab === 'security' && (
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                    <h4 className="font-display text-lg text-white mb-4">Security</h4>

                    <div className="space-y-3">
                      {[
                        { icon: Fingerprint, label: 'Biometric Lock', desc: 'Require fingerprint or face ID', value: bioLock, setter: setBioLock },
                        { icon: Shield, label: 'Two-Factor Auth', desc: 'Extra verification for logins', value: twoFactor, setter: setTwoFactor },
                      ].map((item, i) => (
                        <div key={i} className="flex items-center justify-between p-4 rounded-xl bg-white/3">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-lg bg-amber-500/15 flex items-center justify-center">
                              <item.icon className="w-4 h-4 text-amber-400" />
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-white">{item.label}</p>
                              <p className="text-xs text-white/40">{item.desc}</p>
                            </div>
                          </div>
                          <button
                            onClick={() => item.setter(!item.value)}
                            className={`w-12 h-7 rounded-full transition-colors relative ${item.value ? 'bg-amber-500' : 'bg-white/10'}`}
                          >
                            <motion.div
                              animate={{ x: item.value ? 22 : 2 }}
                              className="w-5 h-5 rounded-full bg-white absolute top-1 shadow"
                            />
                          </button>
                        </div>
                      ))}
                    </div>

                    <div>
                      <label className="text-[10px] text-white/40 tracking-wider font-semibold mb-2 block">SESSION TIMEOUT (MINUTES)</label>
                      <select value={sessionTimeout} onChange={(e) => setSessionTimeout(e.target.value)} className="w-full glass-input rounded-xl px-4 py-3 text-sm text-white">
                        {['5', '10', '15', '30', '60'].map(v => <option key={v} value={v} className="bg-[#0d0d14]">{v} minutes</option>)}
                      </select>
                    </div>

                    <div>
                      <label className="text-[10px] text-white/40 tracking-wider font-semibold mb-2 block">CHANGE SECURITY PIN</label>
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <Key className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                          <input
                            type={showPin ? 'text' : 'password'}
                            value={pin}
                            onChange={(e) => setPin(e.target.value)}
                            placeholder="Enter new PIN"
                            className="w-full glass-input rounded-xl pl-10 pr-4 py-3 text-sm text-white"
                            maxLength={6}
                          />
                        </div>
                        <button onClick={() => setShowPin(!showPin)} className="p-3 rounded-xl glass-btn">
                          {showPin ? <EyeOff className="w-4 h-4 text-white/60" /> : <Eye className="w-4 h-4 text-white/60" />}
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}

                {/* Tab: Notifications */}
                {tab === 'notifications' && (
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                    <h4 className="font-display text-lg text-white mb-4">Notifications</h4>

                    <div className="space-y-3">
                      {[
                        { icon: Smartphone, label: 'Push Notifications', desc: 'Real-time alerts on your device', value: pushNotifs, setter: setPushNotifs },
                        { icon: Mail, label: 'Email Notifications', desc: 'Daily digest and alerts', value: emailNotifs, setter: setEmailNotifs },
                        { icon: Phone, label: 'SMS Alerts', desc: 'Critical alerts via text', value: smsNotifs, setter: setSmsNotifs },
                        { icon: Calendar, label: 'Weekly Report', desc: 'Every Monday spending summary', value: weeklyReport, setter: setWeeklyReport },
                        { icon: Download, label: 'Monthly Statement', desc: 'Downloadable PDF statement', value: monthlyStatement, setter: setMonthlyStatement },
                      ].map((item, i) => (
                        <div key={i} className="flex items-center justify-between p-4 rounded-xl bg-white/3">
                          <div className="flex items-center gap-3">
                            <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${item.value ? 'bg-amber-500/15' : 'bg-white/5'}`}>
                              <item.icon className={`w-4 h-4 ${item.value ? 'text-amber-400' : 'text-white/30'}`} />
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-white">{item.label}</p>
                              <p className="text-xs text-white/40">{item.desc}</p>
                            </div>
                          </div>
                          <button
                            onClick={() => item.setter(!item.value)}
                            className={`w-12 h-7 rounded-full transition-colors relative ${item.value ? 'bg-amber-500' : 'bg-white/10'}`}
                          >
                            <motion.div
                              animate={{ x: item.value ? 22 : 2 }}
                              className="w-5 h-5 rounded-full bg-white absolute top-1 shadow"
                            />
                          </button>
                        </div>
                      ))}
                    </div>

                    <div>
                      <label className="text-[10px] text-white/40 tracking-wider font-semibold mb-2 block">LARGE TRANSACTION ALERT ({'>'}$)</label>
                      <input
                        type="number"
                        value={largeTxAlert}
                        onChange={(e) => setLargeTxAlert(e.target.value)}
                        className="w-full glass-input rounded-xl px-4 py-3 text-sm text-white"
                      />
                    </div>
                  </motion.div>
                )}

                {/* Save + Danger zone */}
                <div className="mt-8 pt-6 border-t border-white/10 space-y-3">
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleSave}
                    className="w-full py-4 rounded-xl bg-linear-to-r from-amber-400 to-yellow-500 text-amber-950 font-bold flex items-center justify-center gap-2 glow-amber"
                  >
                    {saved ? <><Check className="w-4 h-4" /> Saved</> : <><Save className="w-4 h-4" /> Save Changes</>}
                  </motion.button>

                  <button
                    onClick={() => setShowAdvanced(!showAdvanced)}
                    className="w-full text-center py-2 text-xs text-white/30 hover:text-white/60"
                  >
                    {showAdvanced ? 'Hide' : 'Show'} Advanced Options
                  </button>

                  <AnimatePresence>
                    {showAdvanced && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="space-y-3"
                      >
                        <button
                          onClick={() => setConfirmDelete(true)}
                          className="w-full py-3 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-400 font-bold text-sm flex items-center justify-center gap-2"
                        >
                          <Trash2 className="w-4 h-4" />
                          {confirmDelete ? 'Are you sure? This cannot be undone.' : 'Delete Account'}
                        </button>
                        {confirmDelete && (
                          <div className="flex gap-2">
                            <button
                              onClick={() => setConfirmDelete(false)}
                              className="flex-1 py-3 rounded-xl border border-rose-500/40 bg-rose-500/5 text-rose-300 font-bold text-sm"
                            >
                              Cancel
                            </button>
                            <button className="flex-1 py-3 rounded-xl bg-rose-500 text-white font-bold text-sm">
                              Yes, Delete
                            </button>
                          </div>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
