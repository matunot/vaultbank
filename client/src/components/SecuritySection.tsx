import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Shield, ShieldCheck, Lock, Fingerprint, Smartphone, Laptop, Tablet,
  Power, Plus, Trash2, AlertTriangle, CheckCircle2, X, Clock,
} from 'lucide-react';
import { securitySessions, trustedContacts, securityEvents, securityScoreFactors } from '../data';
import RichIcon from './RichIcon';

type SecurityTab = 'center' | 'devices' | 'contacts' | 'logs';

export default function SecuritySection() {
  const [tab, setTab] = useState<SecurityTab>('center');
  const [sessions, setSessions] = useState(securitySessions);
  const [contacts, setContacts] = useState(trustedContacts);
  const [showAddContact, setShowAddContact] = useState(false);
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [newContact, setNewContact] = useState({ name: '', relation: '', phone: '', email: '' });
  
  // Security states
  const [twoFactor, setTwoFactor] = useState(true);
  const [bioLock, setBioLock] = useState(true);
  const [stealthMode, setStealthMode] = useState(false);

  // Computed security score
  const securityScore = useMemo(() => {
    let base = 60;
    if (twoFactor) base += 15;
    if (bioLock) base += 10;
    if (stealthMode) base += 15;
    return Math.min(100, base);
  }, [twoFactor, bioLock, stealthMode]);

  const handleRevokeSession = (id: number) => {
    setSessions(prev => prev.filter(s => s.id !== id));
  };

  const handleAddContact = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newContact.name || !newContact.relation) return;
    setContacts(prev => [
      ...prev,
      {
        id: Date.now(),
        ...newContact,
        img: `https://i.pravatar.cc/150?img=${Math.floor(Math.random() * 70)}`,
      }
    ]);
    setNewContact({ name: '', relation: '', phone: '', email: '' });
    setShowAddContact(false);
  };

  return (
    <div className="space-y-5">
      {/* ── Hero: Security Score ── */}
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative rounded-3xl overflow-hidden iridescent-border"
      >
        <div className="relative p-6 lg:p-8 overflow-hidden bg-linear-to-br from-indigo-500/10 via-purple-500/5 to-cyan-500/10">
          <div className="absolute inset-0 glass opacity-50" />
          <div className="absolute -top-20 -right-20 w-72 h-72 bg-indigo-500/15 rounded-full blur-3xl" />
          <div className="absolute -bottom-20 -left-20 w-72 h-72 bg-emerald-500/10 rounded-full blur-3xl" />

          <div className="relative z-10 grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <RichIcon icon={<Shield size={20} strokeWidth={2.5} />} variant="sapphire" size="lg" glow pulse />
                  <div>
                    <p className="text-xs tracking-[0.4em] text-blue-300/80 font-bold uppercase">SECURITY CONTROL</p>
                    <p className="text-sm text-white/40">Defend your assets with Swiss security standards</p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3 mt-5">
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full glass-btn border border-emerald-500/30">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-xs font-bold text-emerald-300">Military-grade protection</span>
                  </div>
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full glass-btn border border-purple-500/30">
                    <Fingerprint className="w-3.5 h-3.5 text-purple-400" />
                    <span className="text-xs font-bold text-purple-300">Zero-Knowledge Vault</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4 mt-6">
                <div className="glass-btn rounded-xl p-3 text-center">
                  <p className="text-[10px] text-white/40 tracking-wider">ACTIVE SESSIONS</p>
                  <p className="text-xl font-bold text-white mt-1">{sessions.length}</p>
                </div>
                <div className="glass-btn rounded-xl p-3 text-center">
                  <p className="text-[10px] text-white/40 tracking-wider">TRUSTED PAYEES</p>
                  <p className="text-xl font-bold text-white mt-1">{contacts.length}</p>
                </div>
                <div className="glass-btn rounded-xl p-3 text-center">
                  <p className="text-[10px] text-white/40 tracking-wider">ALERTS</p>
                  <p className="text-xl font-bold text-emerald-400 mt-1">Healthy</p>
                </div>
              </div>
            </div>

            {/* Score Ring */}
            <div className="flex flex-col items-center justify-center">
              <p className="text-xs tracking-wider text-white/40 font-semibold mb-3">SECURITY SCORE</p>
              <div className="relative w-40 h-40">
                <svg viewBox="0 0 120 120" className="w-40 h-40 -rotate-90">
                  <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="10" />
                  <motion.circle cx="60" cy="60" r="52" fill="none" stroke="url(#secGrad)" strokeWidth="10" strokeLinecap="round"
                    strokeDasharray={`${2 * Math.PI * 52}`}
                    initial={{ strokeDashoffset: 2 * Math.PI * 52 }}
                    animate={{ strokeDashoffset: 2 * Math.PI * 52 * (1 - securityScore / 100) }}
                    transition={{ duration: 1.5, ease: 'easeOut' }}
                  />
                  <defs>
                    <linearGradient id="secGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#3b82f6" />
                      <stop offset="100%" stopColor="#10b981" />
                    </linearGradient>
                  </defs>
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="font-display text-4xl text-white">{securityScore}%</span>
                  <span className="text-[10px] text-emerald-400 font-bold tracking-wider">{securityScore > 80 ? 'EXCELLENT' : 'GOOD'}</span>
                </div>
              </div>
              <p className="text-[10px] text-white/40 text-center mt-2 max-w-40">
                Toggle advanced locks below to increase score
              </p>
            </div>
          </div>
        </div>
      </motion.div>

      {/* ── Tab Bar ── */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {[
          { id: 'center' as SecurityTab,   label: 'Security Center', icon: Shield,     count: 4 },
          { id: 'devices' as SecurityTab,  label: 'Active Devices',  icon: Laptop,     count: sessions.length },
          { id: 'contacts' as SecurityTab, label: 'Trusted Nominees', icon: UserCircle,  count: contacts.length },
          { id: 'logs' as SecurityTab,     label: 'Audit Log',       icon: Clock,      count: securityEvents.length },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
              tab === t.id ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/30' : 'glass-btn text-white/60 hover:text-white'
            }`}
          >
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
            <span className={`px-1.5 py-0.5 rounded-full text-[9px] ${tab === t.id ? 'bg-white/20' : 'bg-white/10 text-white/40'}`}>{t.count}</span>
          </button>
        ))}
      </div>

      {/* ── Tab Content ── */}
      <AnimatePresence mode="wait">
        {/* ── Security Center (Dashboard) ── */}
        {tab === 'center' && (
          <motion.div
            key="center" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
            className="space-y-5"
          >
            {/* Quick Toggles */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[
                { label: 'Two-Factor Authentication', desc: 'Secure Google Authenticator', value: twoFactor, setter: setTwoFactor, variant: 'gold' as const },
                { label: 'Biometric Access Control', desc: 'Face ID & Touch ID protection', value: bioLock, setter: setBioLock, variant: 'sapphire' as const },
                { label: 'Decoy Stealth Mode', desc: 'Reroutes suspicious traffic', value: stealthMode, setter: setStealthMode, variant: 'amethyst' as const },
              ].map(toggle => (
                <div key={toggle.label} className="glass-panel p-5 rounded-3xl flex flex-col justify-between">
                  <div className="flex justify-between items-start mb-4">
                    <RichIcon icon={<Shield className="w-5 h-5" />} variant={toggle.variant} size="md" glow={toggle.value} />
                    <button
                      onClick={() => toggle.setter(!toggle.value)}
                      className={`w-12 h-7 rounded-full transition-colors relative shrink-0 ${toggle.value ? 'bg-emerald-500 shadow-md shadow-emerald-500/20' : 'bg-white/10'}`}
                    >
                      <motion.div
                        animate={{ x: toggle.value ? 22 : 2 }}
                        className="w-5 h-5 rounded-full bg-white absolute top-1 shadow"
                      />
                    </button>
                  </div>
                  <div>
                    <h4 className="font-bold text-white text-base">{toggle.label}</h4>
                    <p className="text-xs text-white/40 mt-1">{toggle.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Security Audit Checklist */}
            <div className="glass-panel rounded-3xl p-6">
              <h3 className="font-display text-xl text-white mb-5 flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-emerald-400" /> Defense Audit
              </h3>
              <div className="space-y-3">
                {securityScoreFactors.map((factor) => {
                  const isActive = factor.name === 'Hardware Token 2FA' ? twoFactor : factor.name === 'Biometric Access' ? bioLock : factor.name === 'Simulated Stealth Mode' ? stealthMode : true;
                  return (
                    <div key={factor.name} className="p-4 rounded-2xl bg-white/2 border border-white/5 flex items-center gap-4">
                      <RichIcon
                        icon={isActive ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <AlertTriangle className="w-4 h-4 text-rose-400" />}
                        variant={isActive ? 'emerald' : 'ruby'} size="sm"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-white text-sm">{factor.name}</p>
                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${isActive ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'}`}>
                            {isActive ? 'COMPLIANT' : 'ACTION REQUIRED'}
                          </span>
                        </div>
                        <p className="text-xs text-white/40 mt-0.5">{factor.desc}</p>
                      </div>
                      {factor.name === 'Encrypted Recovery Key' && (
                        <button onClick={() => setShowKeyModal(true)} className="px-3 py-1.5 rounded-lg glass-btn text-xs font-semibold text-white/80">
                          Verify Key
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}

        {/* ── Active Devices ── */}
        {tab === 'devices' && (
          <motion.div
            key="devices" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
            className="glass-panel rounded-3xl p-6"
          >
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="font-display text-xl text-white">Trusted Devices</h3>
                <p className="text-xs text-white/40 mt-0.5">Authorize or revoke active sessions on your account</p>
              </div>
              <button className="text-xs font-semibold text-amber-300 hover:text-amber-200">Revoke All</button>
            </div>

            <div className="space-y-3">
              {sessions.map((sess, i) => {
                const Icon = sess.icon === '💻' ? Laptop : sess.icon === '📱' ? Smartphone : Tablet;
                return (
                  <motion.div
                    key={sess.id}
                    initial={{ opacity: 0, x: -16 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.05 }}
                    whileHover={{ x: 4 }}
                    className="flex items-center gap-4 p-4 rounded-2xl bg-white/2 border border-white/5 hover:border-white/15 transition-all"
                  >
                    <RichIcon icon={<Icon className="w-5 h-5" />} variant={sess.current ? 'emerald' : 'sapphire'} size="md" glow={sess.current} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-bold text-white text-sm">{sess.device}</p>
                        {sess.current && (
                          <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-[9px] font-bold text-emerald-300">
                            THIS DEVICE
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-white/40 mt-0.5">{sess.browser} · {sess.location} · {sess.ip}</p>
                    </div>
                    <div className="text-right flex items-center gap-4">
                      <div>
                        <p className="text-[10px] text-white/40">LAST ACTIVE</p>
                        <p className="text-xs font-semibold text-white/80">{sess.date}</p>
                      </div>
                      {!sess.current && (
                        <button
                          onClick={() => handleRevokeSession(sess.id)}
                          className="p-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 text-rose-400 hover:text-rose-300 transition-colors"
                          title="Revoke access"
                        >
                          <Power className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </motion.div>
        )}

        {/* ── Trusted Contacts (Nominees) ── */}
        {tab === 'contacts' && (
          <motion.div
            key="contacts" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
            className="glass-panel rounded-3xl p-6"
          >
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="font-display text-xl text-white">Emergency Nominees</h3>
                <p className="text-xs text-white/40 mt-0.5">Trusted executors who can access funds in unforeseen events</p>
              </div>
              <motion.button
                whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                onClick={() => setShowAddContact(true)}
                className="px-4 py-2 rounded-xl bg-linear-to-r from-blue-400 to-indigo-500 text-white font-bold text-xs shadow-lg"
              >
                <Plus className="w-4 h-4" /> Add Nominee
              </motion.button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {contacts.map((contact, i) => (
                <motion.div
                  key={contact.id}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: i * 0.08 }}
                  whileHover={{ y: -4 }}
                  className="glass p-5 rounded-2xl border border-white/5 relative group"
                >
                  <button
                    onClick={() => setContacts(contacts.filter(c => c.id !== contact.id))}
                    className="absolute top-4 right-4 p-1 rounded-lg bg-white/5 hover:bg-rose-500/20 hover:border-rose-500/30 border border-transparent opacity-0 group-hover:opacity-100 transition-all"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                  </button>

                  <div className="text-center">
                    <img src={contact.img} alt={contact.name} className="w-16 h-16 rounded-full mx-auto object-cover ring-2 ring-indigo-500/20 mb-3" />
                    <p className="font-bold text-white text-base">{contact.name}</p>
                    <span className="inline-block px-2 py-0.5 rounded-full bg-indigo-500/10 border border-indigo-500/25 text-[10px] font-bold text-indigo-400 mt-1">
                      {contact.relation.toUpperCase()}
                    </span>
                    
                    <div className="mt-4 pt-4 border-t border-white/5 space-y-2 text-left text-xs">
                      <div>
                        <span className="text-white/40">Phone:</span>
                        <p className="text-white/80 font-medium">{contact.phone}</p>
                      </div>
                      <div>
                        <span className="text-white/40">Email:</span>
                        <p className="text-white/80 font-medium truncate">{contact.email}</p>
                      </div>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}

        {/* ── Audit Logs ── */}
        {tab === 'logs' && (
          <motion.div
            key="logs" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
            className="glass-panel rounded-3xl p-6"
          >
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="font-display text-xl text-white">Full Security Audit</h3>
                <p className="text-xs text-white/40 mt-0.5">Cryptographic log of all secure account events</p>
              </div>
              <button className="text-xs font-semibold text-amber-300 hover:text-amber-200">Export Logs</button>
            </div>

            <div className="space-y-3">
              {securityEvents.map((evt, i) => (
                <motion.div
                  key={evt.id}
                  initial={{ opacity: 0, x: -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="flex items-start gap-4 p-4 rounded-2xl bg-white/2 border border-white/5"
                >
                  <RichIcon
                    icon={<Lock size={15} />}
                    variant={evt.status === 'success' ? 'emerald' : evt.status === 'warning' ? 'amber' : 'ruby'}
                    size="sm"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-bold text-white text-sm">{evt.event}</p>
                      <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold ${
                        evt.status === 'success' ? 'bg-emerald-500/15 text-emerald-400' : evt.status === 'warning' ? 'bg-amber-500/15 text-amber-400' : 'bg-rose-500/15 text-rose-400'
                      }`}>
                        {evt.status.toUpperCase()}
                      </span>
                    </div>
                    <p className="text-xs text-white/50 mt-1 leading-relaxed">{evt.desc}</p>
                    <p className="text-[10px] text-white/30 mt-2">{evt.date} · Terminal: {evt.ip}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Key Recovery Modal ── */}
      <AnimatePresence>
        {showKeyModal && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setShowKeyModal(false)}
            className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-xl"
          >
            <motion.div
              initial={{ scale: 0.94, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.94, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md rounded-3xl glass-panel p-6 text-center"
            >
              <div className="flex items-center justify-between mb-5">
                <h3 className="font-display text-xl text-white">Recovery Seed Phrase</h3>
                <button onClick={() => setShowKeyModal(false)} className="p-2 rounded-xl glass-btn"><X className="w-4 h-4 text-white/60" /></button>
              </div>

              <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300 text-left mb-6 flex items-start gap-2.5">
                <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                <p>Never share this phrase with anyone, including Vault personnel. Write it down and store it in a physical safe.</p>
              </div>

              {/* Seed Grid */}
              <div className="grid grid-cols-3 gap-2 mb-6">
                {[
                  'timber', 'vital', 'anchor', 'emerald', 'sapphire', 'obsidian',
                  'zurich', 'glacier', 'alpine', 'tunnel', 'discreet', 'shield',
                ].map((word, index) => (
                  <div key={word} className="p-3 rounded-xl bg-white/3 border border-white/5 text-center flex items-center gap-2">
                    <span className="text-[10px] text-white/30 font-bold">{index + 1}</span>
                    <span className="text-sm font-semibold text-white/80">{word}</span>
                  </div>
                ))}
              </div>

              <button
                onClick={() => setShowKeyModal(false)}
                className="w-full py-3 rounded-xl bg-linear-to-r from-amber-400 to-yellow-500 text-amber-950 font-bold text-sm glow-amber flex items-center justify-center gap-2"
              >
                <CheckCircle2 className="w-4 h-4" /> Seed Phrase Verified
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Add Nominee Modal ── */}
      <AnimatePresence>
        {showAddContact && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setShowAddContact(false)}
            className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-xl"
          >
            <motion.div
              initial={{ scale: 0.94, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.94, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md rounded-3xl glass-panel p-6"
            >
              <div className="flex items-center justify-between mb-5">
                <h3 className="font-display text-xl text-white">Add Emergency Nominee</h3>
                <button onClick={() => setShowAddContact(false)} className="p-2 rounded-xl glass-btn"><X className="w-4 h-4 text-white/60" /></button>
              </div>

              <form onSubmit={handleAddContact} className="space-y-4">
                <div>
                  <label className="text-[10px] text-white/40 tracking-wider font-semibold mb-2 block">FULL NAME</label>
                  <input
                    value={newContact.name} onChange={e => setNewContact({ ...newContact, name: e.target.value })}
                    placeholder="Enter full name" className="w-full glass-input rounded-xl px-4 py-3 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-white/40 tracking-wider font-semibold mb-2 block">RELATIONSHIP</label>
                  <input
                    value={newContact.relation} onChange={e => setNewContact({ ...newContact, relation: e.target.value })}
                    placeholder="e.g. Spouse, Attorney, Child" className="w-full glass-input rounded-xl px-4 py-3 text-sm text-white"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] text-white/40 tracking-wider font-semibold mb-2 block">PHONE</label>
                    <input
                      value={newContact.phone} onChange={e => setNewContact({ ...newContact, phone: e.target.value })}
                      placeholder="+41 79 ***" className="w-full glass-input rounded-xl px-4 py-3 text-sm text-white"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-white/40 tracking-wider font-semibold mb-2 block">EMAIL</label>
                    <input
                      value={newContact.email} onChange={e => setNewContact({ ...newContact, email: e.target.value })}
                      placeholder="email@address.com" className="w-full glass-input rounded-xl px-4 py-3 text-sm text-white"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  className="w-full py-4 mt-3 rounded-xl bg-linear-to-r from-blue-400 to-indigo-500 text-white font-bold text-sm glow-blue flex items-center justify-center gap-2"
                >
                  <Plus className="w-4 h-4" /> Add Nominee
                </button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Simple fallback icon wrapper for tab bar
function UserCircle(props: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={props.className}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
