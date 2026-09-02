import 'dotenv/config'
import { prisma } from '../src/prisma'
import bcrypt from 'bcryptjs'

// ── helpers ──────────────────────────────────────────────────────────────────

function daysAgo(n: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(9 + (n * 3) % 9, (n * 17) % 60, 0, 0)
  return d
}

function daysFromNow(n: number): Date {
  const d = new Date()
  d.setDate(d.getDate() + n)
  d.setHours(18, 0, 0, 0)
  return d
}

const ci = (value: string) => ({ equals: value, mode: 'insensitive' as const })

// ── upsert helpers (idempotent — safe to re-run) ─────────────────────────────

async function ensureVertical(name: string, desc?: string) {
  return (await prisma.vertical.findFirst({ where: { verticalName: ci(name) } }))
    ?? prisma.vertical.create({ data: { verticalName: name, description: desc } })
}

async function ensureSector(name: string, desc?: string) {
  return (await prisma.sector.findFirst({ where: { sectorName: ci(name) } }))
    ?? prisma.sector.create({ data: { sectorName: name, description: desc } })
}

async function ensureStatus(name: string, category: string, order: number) {
  return (await prisma.leadStatus.findFirst({ where: { statusName: ci(name) } }))
    ?? prisma.leadStatus.create({ data: { statusName: name, statusCategory: category, displayOrder: order } })
}

async function ensureClientCategory(name: string, desc?: string) {
  return (await prisma.clientCategory.findFirst({ where: { categoryName: ci(name) } }))
    ?? prisma.clientCategory.create({ data: { categoryName: name, description: desc } })
}

async function ensureLeadSource(name: string, desc?: string) {
  return (await prisma.leadSource.findFirst({ where: { sourceName: ci(name) } }))
    ?? prisma.leadSource.create({ data: { sourceName: name, description: desc } })
}

async function ensureServiceType(name: string, desc?: string) {
  return (await prisma.serviceType.findFirst({ where: { serviceTypeName: ci(name) } }))
    ?? prisma.serviceType.create({ data: { serviceTypeName: name, description: desc } })
}

async function ensureClient(name: string, categoryId: string, region: string) {
  return (await prisma.client.findFirst({ where: { clientName: ci(name) } }))
    ?? prisma.client.create({ data: { clientName: name, categoryId, country: 'India', region } })
}

async function ensureEvent(name: string, type: string, date: Date, creatorId: string) {
  return (await prisma.event.findFirst({ where: { eventName: ci(name) } }))
    ?? prisma.event.create({ data: { eventName: name, eventType: type, eventDate: date, createdByUserId: creatorId } })
}

async function ensureUser(email: string, opts: { userName: string; role?: string; department?: string; phone?: string; password?: string }) {
  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) return existing
  return prisma.user.create({
    data: {
      email,
      userName: opts.userName,
      role: opts.role ?? 'employee',
      department: opts.department,
      phoneNumber: opts.phone,
      passwordHash: opts.password ? await bcrypt.hash(opts.password, 12) : null,
    },
  })
}

async function ensureLocation(city: string, state: string, country = 'India') {
  return (await prisma.location.findFirst({ where: { city: ci(city) } }))
    ?? prisma.location.create({ data: { city, state, country } })
}

async function ensurePlant(name: string, company: string, locationId: string, code: string) {
  return (await prisma.plant.findFirst({ where: { plantName: ci(name) } }))
    ?? prisma.plant.create({ data: { plantName: name, companyName: company, locationId, plantCode: code } })
}

async function ensureContact(plantId: string, name: string, designation: string, phone: string, email: string) {
  return (await prisma.contact.findFirst({ where: { plantId, contactPersonName: ci(name) } }))
    ?? prisma.contact.create({ data: { plantId, contactPersonName: name, designation, contactPersonNumber: phone, mailId: email, isPrimaryContact: true } })
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('seeding reference data...')

  const verticals = {
    arVr:      await ensureVertical('AR/VR', 'Augmented and virtual reality for industrial training and visualization'),
    digitalTx: await ensureVertical('Digital Transformation', 'End-to-end digitization of industrial processes and workflows'),
    reverseEng: await ensureVertical('Reverse Engineering', 'Component scanning, modeling, and legacy part reproduction'),
    aiAuto:    await ensureVertical('AI Automation', 'AI-powered quality inspection, predictive maintenance, and process optimization'),
    iot:       await ensureVertical('IoT & Industry 4.0', 'Connected sensor networks, real-time monitoring, and smart factory solutions'),
    scanning:  await ensureVertical('3D Scanning & Modeling', 'Laser scanning, point cloud processing, and as-built 3D documentation'),
  }

  const sectors = {
    steel:  await ensureSector('Steel', 'Integrated steel mills and processing plants'),
    oilGas: await ensureSector('Oil and Gas', 'Refineries, petrochemical complexes, and pipeline infrastructure'),
    power:  await ensureSector('Power', 'Thermal, solar, and renewable energy generation facilities'),
    cement: await ensureSector('Cement', 'Cement manufacturing and grinding units'),
    auto:   await ensureSector('Automotive', 'Vehicle and component manufacturing plants'),
    pharma: await ensureSector('Pharmaceuticals', 'API manufacturing and formulation plants'),
    mining: await ensureSector('Mining', 'Open-cast and underground mining operations'),
  }

  const statuses = {
    submitted: await ensureStatus('Submitted', 'Open', 1),
    qualified: await ensureStatus('Qualified', 'Open', 2),
    inProcess: await ensureStatus('In Process', 'In Progress', 3),
    won:       await ensureStatus('Won', 'Closed Won', 4),
    dead:      await ensureStatus('Dead', 'Closed Lost', 5),
  }

  console.log('seeding catalog lookups (client categories, lead sources, service types)...')

  const clientCategories = {
    govt:       await ensureClientCategory('Govt', 'Government departments and agencies'),
    private:    await ensureClientCategory('Private', 'Privately held companies'),
    psu:        await ensureClientCategory('PSU', 'Public sector undertakings'),
    epc:        await ensureClientCategory('EPC', 'Engineering, procurement and construction contractors'),
    consultant: await ensureClientCategory('Consultant', 'Third-party consulting and advisory firms'),
  }

  const sources = {
    expo:      await ensureLeadSource('Expo'),
    reference: await ensureLeadSource('Reference'),
    website:   await ensureLeadSource('Website'),
    coldMail:  await ensureLeadSource('Cold mail'),
    call:      await ensureLeadSource('Call'),
  }

  const serviceTypes = {
    laserScanning:  await ensureServiceType('Laser scanning'),
    modelling3d:    await ensureServiceType('3D modelling'),
    bim:            await ensureServiceType('BIM'),
    rbi:            await ensureServiceType('RBI'),
    tankInspection: await ensureServiceType('Tank inspection'),
    sop:            await ensureServiceType('SOP'),
    engineering:    await ensureServiceType('Engineering services'),
  }

  console.log('seeding users...')

  const admin = await ensureUser('dev@leadops.local', {
    userName: 'Dev Admin', role: 'admin', department: 'Management', password: 'devmode123',
  })

  const emp = {
    arjun:  await ensureUser('arjun.mehta@leadops.local',  { userName: 'Arjun Mehta',    department: 'Business Development', phone: '+91-98765-43210', password: 'demo123' }),
    priya:  await ensureUser('priya.sharma@leadops.local', { userName: 'Priya Sharma',   department: 'Sales',                phone: '+91-98765-43211', password: 'demo123' }),
    vikram: await ensureUser('vikram.desai@leadops.local', { userName: 'Vikram Desai',   department: 'Business Development', phone: '+91-98765-43212', password: 'demo123' }),
    neha:   await ensureUser('neha.rajput@leadops.local',  { userName: 'Neha Rajput',    department: 'Sales',                phone: '+91-98765-43213', password: 'demo123' }),
    rohan:  await ensureUser('rohan.kulkarni@leadops.local', { userName: 'Rohan Kulkarni', department: 'Technical Sales',    phone: '+91-98765-43214', password: 'demo123' }),
  }

  console.log('seeding locations, clients, plants, contacts...')

  const loc = {
    jamshedpur: await ensureLocation('Jamshedpur', 'Jharkhand'),
    vizag:      await ensureLocation('Visakhapatnam', 'Andhra Pradesh'),
    bhilai:     await ensureLocation('Bhilai', 'Chhattisgarh'),
    pune:       await ensureLocation('Pune', 'Maharashtra'),
    mumbai:     await ensureLocation('Mumbai', 'Maharashtra'),
    haldia:     await ensureLocation('Haldia', 'West Bengal'),
    chennai:    await ensureLocation('Chennai', 'Tamil Nadu'),
    mundra:     await ensureLocation('Mundra', 'Gujarat'),
    nashik:     await ensureLocation('Nashik', 'Maharashtra'),
    rourkela:   await ensureLocation('Rourkela', 'Odisha'),
    manesar:    await ensureLocation('Manesar', 'Haryana'),
    aurangabad: await ensureLocation('Aurangabad', 'Maharashtra'),
    bilaspur:   await ensureLocation('Bilaspur', 'Chhattisgarh'),
    kurkumbh:   await ensureLocation('Kurkumbh', 'Maharashtra'),
  }

  const clients = {
    tataSteel:  await ensureClient('Tata Steel', clientCategories.private.id, 'Jharkhand'),
    rinl:       await ensureClient('RINL', clientCategories.psu.id, 'Andhra Pradesh'),
    sail:       await ensureClient('SAIL', clientCategories.psu.id, 'Chhattisgarh'),
    jsw:        await ensureClient('JSW Steel', clientCategories.private.id, 'Maharashtra'),
    iocl:       await ensureClient('Indian Oil Corporation', clientCategories.psu.id, 'West Bengal'),
    bpcl:       await ensureClient('Bharat Petroleum', clientCategories.psu.id, 'Maharashtra'),
    hpcl:       await ensureClient('Hindustan Petroleum', clientCategories.psu.id, 'Andhra Pradesh'),
    adani:      await ensureClient('Adani Power', clientCategories.private.id, 'Gujarat'),
    ntpc:       await ensureClient('NTPC Limited', clientCategories.psu.id, 'Chhattisgarh'),
    ultratech:  await ensureClient('UltraTech Cement', clientCategories.private.id, 'Maharashtra'),
    acc:        await ensureClient('ACC Limited', clientCategories.private.id, 'Chhattisgarh'),
    maruti:     await ensureClient('Maruti Suzuki', clientCategories.private.id, 'Haryana'),
    tataMotors: await ensureClient('Tata Motors', clientCategories.private.id, 'Maharashtra'),
    mahindra:   await ensureClient('Mahindra & Mahindra', clientCategories.private.id, 'Maharashtra'),
    bajaj:      await ensureClient('Bajaj Auto', clientCategories.private.id, 'Maharashtra'),
    ashok:      await ensureClient('Ashok Leyland', clientCategories.private.id, 'Tamil Nadu'),
    cipla:      await ensureClient('Cipla Limited', clientCategories.private.id, 'Maharashtra'),
  }

  const companyToClientKey: Record<string, keyof typeof clients> = {
    'Tata Steel': 'tataSteel', 'RINL': 'rinl', 'SAIL': 'sail', 'JSW Steel': 'jsw',
    'Indian Oil Corporation': 'iocl', 'Bharat Petroleum': 'bpcl', 'Hindustan Petroleum': 'hpcl',
    'Adani Power': 'adani', 'NTPC Limited': 'ntpc', 'UltraTech Cement': 'ultratech',
    'ACC Limited': 'acc', 'Maruti Suzuki': 'maruti', 'Tata Motors': 'tataMotors',
    'Mahindra & Mahindra': 'mahindra', 'Bajaj Auto': 'bajaj', 'Ashok Leyland': 'ashok', 'Cipla Limited': 'cipla',
  }

  const plantDefs = [
    { key: 'tataSteel',        name: 'Tata Steel Works',              company: 'Tata Steel',            loc: loc.jamshedpur, code: 'TSJ-001', contact: { name: 'Rajesh Kumar',         title: 'VP Operations',          phone: '+91-657-664-1234', email: 'rajesh.kumar@tatasteel.com' } },
    { key: 'rinl',             name: 'Rashtriya Ispat Nigam',         company: 'RINL',                  loc: loc.vizag,      code: 'RIN-001', contact: { name: 'Sunita Patel',         title: 'Chief Technology Officer', phone: '+91-891-251-8901', email: 'sunita.patel@rinl.in' } },
    { key: 'sailBhilai',      name: 'SAIL Bhilai Steel Plant',       company: 'SAIL',                  loc: loc.bhilai,     code: 'BSP-001', contact: { name: 'Deepak Verma',         title: 'DGM Maintenance',        phone: '+91-788-222-5678', email: 'deepak.verma@sail.in' } },
    { key: 'sailRourkela',    name: 'SAIL Rourkela Steel Plant',     company: 'SAIL',                  loc: loc.rourkela,   code: 'RSP-001', contact: { name: 'Anand Sharma',         title: 'GM Projects',            phone: '+91-661-264-1234', email: 'anand.sharma@sail.in' } },
    { key: 'jswDolvi',        name: 'JSW Steel Dolvi Works',         company: 'JSW Steel',             loc: loc.mumbai,     code: 'JSD-001', contact: { name: 'Kavita Nair',          title: 'Plant Head',             phone: '+91-22-4286-5678', email: 'kavita.nair@jsw.in' } },
    { key: 'ioclHaldia',      name: 'IOCL Haldia Refinery',          company: 'Indian Oil Corporation', loc: loc.haldia,     code: 'IOC-001', contact: { name: 'Prakash Menon',        title: 'VP Engineering',         phone: '+91-3224-252-890', email: 'prakash.menon@iocl.co.in' } },
    { key: 'bpclMumbai',      name: 'BPCL Mumbai Refinery',          company: 'Bharat Petroleum',      loc: loc.mumbai,     code: 'BPC-001', contact: { name: 'Suresh Reddy',         title: 'DGM Process',            phone: '+91-22-2554-9012', email: 'suresh.reddy@bharatpetroleum.in' } },
    { key: 'hpclVizag',       name: 'HPCL Vizag Refinery',           company: 'Hindustan Petroleum',   loc: loc.vizag,      code: 'HPC-001', contact: { name: 'Meena Iyer',           title: 'GM Technical',           phone: '+91-891-256-7890', email: 'meena.iyer@hpcl.co.in' } },
    { key: 'adaniMundra',     name: 'Adani Power Mundra',            company: 'Adani Power',           loc: loc.mundra,     code: 'APM-001', contact: { name: 'Amit Joshi',           title: 'Head of Operations',     phone: '+91-2838-255-345', email: 'amit.joshi@adani.com' } },
    { key: 'ntpcSipat',       name: 'NTPC Sipat Super Thermal',      company: 'NTPC Limited',          loc: loc.bilaspur,   code: 'NTP-001', contact: { name: 'Ramesh Gupta',         title: 'Sr. Manager Maintenance', phone: '+91-7752-253-678', email: 'ramesh.gupta@ntpc.co.in' } },
    { key: 'ultratechCement', name: 'UltraTech Cement Awarpur',      company: 'UltraTech Cement',      loc: loc.aurangabad, code: 'UTC-001', contact: { name: 'Pooja Agarwal',        title: 'VP Manufacturing',       phone: '+91-2432-242-567', email: 'pooja.agarwal@adityabirla.com' } },
    { key: 'accWadi',         name: 'ACC Wadi Cement Works',         company: 'ACC Limited',           loc: loc.bhilai,     code: 'ACC-001', contact: { name: 'Sanjay Kulkarni',      title: 'Plant Manager',          phone: '+91-8474-220-456', email: 'sanjay.kulkarni@acclimited.com' } },
    { key: 'marutiManesar',   name: 'Maruti Suzuki Manesar Plant',   company: 'Maruti Suzuki',         loc: loc.manesar,    code: 'MSI-001', contact: { name: 'Vivek Tandon',         title: 'AGM Production',         phone: '+91-124-470-1234', email: 'vivek.tandon@maruti.co.in' } },
    { key: 'tataMotorsPune',  name: 'Tata Motors Pune Plant',        company: 'Tata Motors',           loc: loc.pune,       code: 'TMP-001', contact: { name: 'Nitin Patil',          title: 'DGM Engineering',        phone: '+91-20-6613-5678', email: 'nitin.patil@tatamotors.com' } },
    { key: 'mahindraNashik',  name: 'Mahindra Nashik Plant',         company: 'Mahindra & Mahindra',   loc: loc.nashik,     code: 'MNP-001', contact: { name: 'Anil Bhosale',         title: 'GM Plant Operations',    phone: '+91-253-230-2345', email: 'anil.bhosale@mahindra.com' } },
    { key: 'bajajAurangabad', name: 'Bajaj Auto Waluj Plant',        company: 'Bajaj Auto',            loc: loc.aurangabad, code: 'BAW-001', contact: { name: 'Rakesh Jain',          title: 'VP Technical',           phone: '+91-240-660-4567', email: 'rakesh.jain@bajajauto.co.in' } },
    { key: 'ashokLeyland',    name: 'Ashok Leyland Ennore Plant',    company: 'Ashok Leyland',         loc: loc.chennai,    code: 'ALC-001', contact: { name: 'Lakshmi Subramanian',  title: 'CTO',                    phone: '+91-44-2854-6789', email: 'lakshmi.s@ashokleyland.com' } },
    { key: 'ciplaPune',       name: 'Cipla Kurkumbh Plant',          company: 'Cipla Limited',         loc: loc.kurkumbh,   code: 'CIP-001', contact: { name: 'Ravi Deshmukh',        title: 'Head of Engineering',    phone: '+91-2111-264-890', email: 'ravi.deshmukh@cipla.com' } },
  ]

  const plants: Record<string, { plant: Awaited<ReturnType<typeof ensurePlant>>; contact: Awaited<ReturnType<typeof ensureContact>> }> = {}
  for (const p of plantDefs) {
    const plant = await ensurePlant(p.name, p.company, p.loc.id, p.code)
    const clientKey = companyToClientKey[p.company]
    if (clientKey && !plant.clientId) {
      await prisma.plant.update({ where: { id: plant.id }, data: { clientId: clients[clientKey].id } })
    }
    const contact = await ensureContact(plant.id, p.contact.name, p.contact.title, p.contact.phone, p.contact.email)
    plants[p.key] = { plant, contact }
  }

  console.log('seeding events...')
  const events = {
    imtex:       await ensureEvent('IMTEX 2026', 'Expo', daysAgo(60), admin.id),
    steelSummit: await ensureEvent('Steel Innovation Summit 2026', 'Expo', daysAgo(35), admin.id),
    bhilaiVisit: await ensureEvent('Client Site Visit — Bhilai', 'Visit', daysAgo(20), admin.id),
  }

  // ── leads (only seed if DB has few leads) ─────────────────────────────────

  const leadCount = await prisma.lead.count({ where: { deletedAt: null } })
  if (leadCount > 5) {
    console.log(`${leadCount} leads already present — skipping lead seeding`)
  } else {
    console.log('seeding leads...')

    const leadDefs: {
      plant: string; vertical: typeof verticals[keyof typeof verticals]; sector: typeof sectors[keyof typeof sectors]
      status: typeof statuses[keyof typeof statuses]; assignee: typeof emp[keyof typeof emp] | null
      ago: number; remark: string
    }[] = [
      // Week 8 (49-55 days ago) — oldest leads, furthest along in the pipeline
      { plant: 'tataSteel',    vertical: verticals.arVr,      sector: sectors.steel,  status: statuses.won,       assignee: emp.arjun,  ago: 52, remark: 'Signed 3-year AR training platform contract. Phase 1 deployment in Q3.' },
      { plant: 'rinl',         vertical: verticals.digitalTx, sector: sectors.steel,  status: statuses.inProcess, assignee: emp.priya,  ago: 50, remark: 'Pilot digital twin POC underway in rolling mill section. Feedback positive from operations team.' },

      // Week 7 (42-48 days ago)
      { plant: 'sailBhilai',   vertical: verticals.reverseEng, sector: sectors.steel,  status: statuses.won,       assignee: emp.vikram, ago: 46, remark: 'Contract signed for spare parts reverse engineering program. Initial batch of 50 critical components.' },
      { plant: 'ioclHaldia',   vertical: verticals.aiAuto,     sector: sectors.oilGas, status: statuses.inProcess, assignee: emp.neha,   ago: 44, remark: 'AI-based leak detection proposal shared. Technical committee review scheduled for next week.' },
      { plant: 'bpclMumbai',   vertical: verticals.digitalTx,  sector: sectors.oilGas, status: statuses.dead,      assignee: emp.arjun,  ago: 43, remark: 'Budget reallocated to refinery turnaround. Client asked to revisit in next fiscal year.' },

      // Week 6 (35-41 days ago)
      { plant: 'adaniMundra',  vertical: verticals.iot,       sector: sectors.power,  status: statuses.inProcess, assignee: emp.rohan,  ago: 39, remark: 'IoT sensor network POC approved for Unit 3 boiler monitoring. Hardware procurement initiated.' },
      { plant: 'jswDolvi',     vertical: verticals.scanning,  sector: sectors.steel,  status: statuses.qualified, assignee: emp.priya,  ago: 37, remark: 'Plant walkthrough completed. Detailed scope document shared. Awaiting capex approval from JSW HQ.' },
      { plant: 'marutiManesar', vertical: verticals.aiAuto,    sector: sectors.auto,   status: statuses.inProcess, assignee: emp.vikram, ago: 36, remark: 'AI vision-based defect detection POC in paint shop. 97% accuracy achieved in initial trials.' },
      { plant: 'hpclVizag',    vertical: verticals.digitalTx,  sector: sectors.oilGas, status: statuses.dead,      assignee: emp.arjun,  ago: 38, remark: 'Lost to competitor offering integrated SAP-based solution. Price was not the deciding factor.' },

      // Week 5 (28-34 days ago)
      { plant: 'tataMotorsPune', vertical: verticals.arVr,     sector: sectors.auto,   status: statuses.qualified, assignee: emp.neha,   ago: 32, remark: 'Initial AR maintenance demo well received by engineering team. Follow-up meeting with VP Engineering confirmed.' },
      { plant: 'ntpcSipat',     vertical: verticals.iot,       sector: sectors.power,  status: statuses.inProcess, assignee: emp.rohan,  ago: 30, remark: 'Vibration monitoring sensors deployed on 2 turbines. Data collection phase — 30-day baseline in progress.' },
      { plant: 'ultratechCement', vertical: verticals.digitalTx, sector: sectors.cement, status: statuses.submitted, assignee: emp.priya, ago: 29, remark: 'Introductory meeting done. Client interested in kiln optimization digital twin.' },

      // Week 4 (21-27 days ago)
      { plant: 'accWadi',        vertical: verticals.reverseEng, sector: sectors.cement, status: statuses.qualified, assignee: emp.vikram, ago: 26, remark: 'Cement mill component scanning proposal under review by plant engineering team.' },
      { plant: 'mahindraNashik', vertical: verticals.aiAuto,     sector: sectors.auto,   status: statuses.inProcess, assignee: emp.arjun,  ago: 24, remark: 'Welding quality AI module integration ongoing with robotics team. Phase 1 covering 3 welding stations.' },
      { plant: 'bajajAurangabad', vertical: verticals.arVr,      sector: sectors.auto,   status: statuses.submitted, assignee: emp.neha,   ago: 23, remark: 'AR assembly training proposal sent. Client evaluating alongside 2 other vendors.' },
      { plant: 'sailRourkela',   vertical: verticals.scanning,   sector: sectors.steel,  status: statuses.qualified, assignee: emp.rohan,  ago: 22, remark: 'Plant digitization project shortlisted. Waiting for formal tender release in September.' },
      { plant: 'ciplaPune',      vertical: verticals.aiAuto,     sector: sectors.pharma, status: statuses.submitted, assignee: emp.priya,  ago: 21, remark: 'AI quality control for tablet inspection discussed. Client wants to see pharma-specific case studies.' },

      // Week 3 (14-20 days ago)
      { plant: 'ashokLeyland',   vertical: verticals.digitalTx,  sector: sectors.auto,   status: statuses.submitted, assignee: emp.vikram, ago: 18, remark: 'Digital thread concept presented. CTO interested but needs board approval for budget allocation.' },
      { plant: 'tataSteel',      vertical: verticals.iot,        sector: sectors.steel,  status: statuses.qualified, assignee: emp.arjun,  ago: 16, remark: 'Second engagement — IoT for blast furnace monitoring. Building on the AR contract relationship.' },
      { plant: 'ioclHaldia',     vertical: verticals.scanning,   sector: sectors.oilGas, status: statuses.submitted, assignee: emp.neha,   ago: 15, remark: 'Pipeline corridor 3D documentation project. Initial scope discussion completed.' },
      { plant: 'adaniMundra',    vertical: verticals.aiAuto,     sector: sectors.power,  status: statuses.submitted, assignee: emp.rohan,  ago: 14, remark: 'Second engagement — AI-based coal quality analysis system. Linked to ongoing IoT project.' },

      // Week 2 (7-13 days ago)
      { plant: 'jswDolvi',       vertical: verticals.reverseEng, sector: sectors.steel,  status: statuses.submitted, assignee: emp.priya,  ago: 12, remark: 'Reverse engineering for hot strip mill roller components. Urgent replacement need.' },
      { plant: 'bpclMumbai',     vertical: verticals.iot,        sector: sectors.oilGas, status: statuses.submitted, assignee: emp.vikram, ago: 11, remark: 'New contact at BPCL — different department from earlier dead lead. IoT for tank farm monitoring.' },
      { plant: 'marutiManesar',  vertical: verticals.digitalTx,  sector: sectors.auto,   status: statuses.qualified, assignee: emp.arjun,  ago: 9,  remark: 'Second engagement — digital twin for assembly line optimization. Building on successful AI POC.' },
      { plant: 'rinl',           vertical: verticals.aiAuto,     sector: sectors.steel,  status: statuses.submitted, assignee: emp.neha,   ago: 8,  remark: 'AI-based slab defect detection proposal. Leveraging ongoing digital twin relationship.' },
      { plant: 'ntpcSipat',      vertical: verticals.arVr,       sector: sectors.power,  status: statuses.submitted, assignee: emp.rohan,  ago: 7,  remark: 'AR-based safety training module for boiler operations. H&S department initiated the inquiry.' },
      { plant: 'ultratechCement', vertical: verticals.reverseEng, sector: sectors.cement, status: statuses.submitted, assignee: emp.priya,  ago: 10, remark: 'Reverse engineering for vertical roller mill segments. Imported parts with long lead times.' },

      // Week 1 (0-6 days ago — this week, newest leads)
      { plant: 'tataMotorsPune',  vertical: verticals.scanning,  sector: sectors.auto,   status: statuses.submitted, assignee: emp.vikram, ago: 5,  remark: 'Plant floor 3D documentation for new EV production line layout planning.' },
      { plant: 'hpclVizag',      vertical: verticals.iot,        sector: sectors.oilGas, status: statuses.submitted, assignee: emp.arjun,  ago: 4,  remark: 'Corrosion monitoring IoT system for distillation columns. New contact from process engineering.' },
      { plant: 'mahindraNashik', vertical: verticals.digitalTx,  sector: sectors.auto,   status: statuses.submitted, assignee: null,       ago: 3,  remark: 'Inbound inquiry for shop floor digitization. Needs assignment.' },
      { plant: 'ciplaPune',      vertical: verticals.reverseEng, sector: sectors.pharma, status: statuses.submitted, assignee: emp.neha,   ago: 2,  remark: 'Reverse engineering of legacy tablet press tooling. Urgent — OEM discontinued the parts.' },
      { plant: 'accWadi',        vertical: verticals.aiAuto,     sector: sectors.cement, status: statuses.submitted, assignee: null,       ago: 1,  remark: 'AI-based predictive maintenance for rotary kiln. Inbound from plant manager — needs assignment.' },
    ]

    const sourceList = Object.values(sources)
    const serviceTypeList = Object.values(serviceTypes)
    const eventList = Object.values(events)

    for (const [i, l] of leadDefs.entries()) {
      const p = plants[l.plant]
      await prisma.lead.create({
        data: {
          plantId: p.plant.id,
          verticalId: l.vertical.id,
          sectorId: l.sector.id,
          contactId: p.contact.id,
          sourceId: sourceList[i % sourceList.length].id,
          serviceTypeId: serviceTypeList[i % serviceTypeList.length].id,
          eventId: i % 6 === 0 ? eventList[Math.floor(i / 6) % eventList.length].id : null,
          assignedToUserId: l.assignee?.id ?? null,
          assignedByUserId: l.assignee ? admin.id : null,
          statusId: l.status.id,
          remark: l.remark,
          createdByUserId: admin.id,
          createdAt: daysAgo(l.ago),
        },
      })
    }
    console.log(`seeded ${leadDefs.length} leads`)
  }

  // ── tasks ─────────────────────────────────────────────────────────────────

  const taskCount = await prisma.task.count({ where: { deletedAt: null } })
  if (taskCount <= 3) {
    console.log('seeding tasks...')

    const taskDefs = [
      // Done
      { title: 'Review AR/VR demo materials for Tata Steel presentation',               desc: 'Ensure all simulation assets are updated for the new blast furnace training module.',                            assignee: emp.arjun,  deadline: daysAgo(21), status: 'Done',        ago: 28 },
      { title: 'Prepare cost estimation for SAIL Bhilai reverse engineering',            desc: 'Detailed BOQ for 50-component reverse engineering program including scanning, modeling, and validation.',          assignee: emp.vikram, deadline: daysAgo(14), status: 'Done',        ago: 21 },
      { title: 'Schedule site visit at IOCL Haldia refinery',                            desc: "Coordinate with Prakash Menon's team for the AI leak detection system walkthrough.",                              assignee: emp.neha,   deadline: daysAgo(10), status: 'Done',        ago: 14 },
      // In Progress
      { title: 'Draft technical proposal for Maruti AI inspection system',               desc: 'Include defect classification taxonomy, camera placement plan, and ROI projections for paint shop deployment.',  assignee: emp.vikram, deadline: daysFromNow(5),  status: 'In Progress', ago: 7 },
      { title: 'Coordinate 3D scanning pilot at JSW Dolvi',                              desc: 'Arrange equipment logistics and operator scheduling for the hot strip mill area scanning.',                       assignee: emp.priya,  deadline: daysFromNow(3),  status: 'In Progress', ago: 5 },
      { title: 'Prepare quarterly pipeline review presentation',                         desc: 'Compile all lead metrics, conversion stats, and revenue projections for the leadership review.',                  assignee: emp.arjun,  deadline: daysFromNow(7),  status: 'In Progress', ago: 10 },
      { title: 'Follow up on NTPC Sipat IoT sensor deployment',                          desc: 'Get timeline confirmation for Phase 2 vibration sensors on turbines 3 and 4.',                                   assignee: emp.rohan,  deadline: daysFromNow(4),  status: 'In Progress', ago: 6 },
      // Pending
      { title: 'Submit RFP response for Adani Mundra digital twin',                      desc: 'Complete technical and commercial sections. Include references from Tata Steel and SAIL projects.',               assignee: emp.rohan,  deadline: daysFromNow(2),  status: 'Pending',    ago: 4 },
      { title: 'Collect plant layout drawings from UltraTech Cement',                     desc: 'Need AutoCAD files of kiln area for digital twin modeling scope estimation.',                                     assignee: emp.priya,  deadline: daysAgo(2),      status: 'Pending',    ago: 8 },
      { title: 'Arrange demo of AI quality control module for Bajaj Auto',               desc: 'Set up a live demo of the component inspection module adapted for automotive use cases.',                          assignee: emp.neha,   deadline: daysFromNow(10), status: 'Pending',    ago: 3 },
      { title: 'Update CRM notes for all Oil & Gas sector leads',                         desc: 'Review and update status notes for IOCL, BPCL, and HPCL leads. Some remarks are outdated.',                     assignee: emp.arjun,  deadline: daysAgo(3),      status: 'Pending',    ago: 10 },
      { title: 'Send revised quotation to Tata Motors engineering team',                  desc: 'Updated pricing for the AR maintenance module based on the reduced scope discussed last week.',                   assignee: emp.vikram, deadline: daysFromNow(6),  status: 'Pending',    ago: 2 },
    ]

    for (const t of taskDefs) {
      await prisma.task.create({
        data: {
          title: t.title,
          description: t.desc,
          deadline: t.deadline,
          status: t.status,
          assignedToUserId: t.assignee.id,
          assignedByUserId: admin.id,
          createdAt: daysAgo(t.ago),
        },
      })
    }
    console.log(`seeded ${taskDefs.length} tasks`)
  } else {
    console.log(`${taskCount} tasks already present — skipped`)
  }

  // ── notifications ─────────────────────────────────────────────────────────

  const notifCount = await prisma.notification.count()
  if (notifCount <= 5) {
    console.log('seeding notifications...')

    const adminNotifs = [
      { msg: 'Vikram Desai marked "Prepare cost estimation for SAIL Bhilai" as Done',                          ago: 1, read: false },
      { msg: 'New lead submitted: ACC Wadi Cement Works — AI Automation (unassigned)',                          ago: 1, read: false },
      { msg: 'Neha Rajput assigned to lead: Cipla Kurkumbh Plant — Reverse Engineering',                       ago: 2, read: false },
      { msg: 'Lead status updated: Maruti Suzuki Digital Transformation → Qualified',                           ago: 3, read: true },
      { msg: 'Task overdue: "Update CRM notes for Oil & Gas leads" — assigned to Arjun Mehta',                  ago: 3, read: true },
      { msg: 'Arjun Mehta assigned to lead: HPCL Vizag Refinery — IoT & Industry 4.0',                         ago: 4, read: true },
      { msg: 'New lead submitted: Mahindra Nashik Plant — Digital Transformation (unassigned)',                  ago: 5, read: true },
      { msg: 'Rohan Kulkarni: NTPC Sipat IoT — baseline data collection at 60%',                                ago: 6, read: true },
    ]

    for (const n of adminNotifs) {
      await prisma.notification.create({
        data: { userId: admin.id, message: n.msg, isRead: n.read, createdAt: daysAgo(n.ago) },
      })
    }

    const empNotifs = [
      { userId: emp.arjun.id,  msg: "You've been assigned a new lead: HPCL Vizag Refinery — IoT & Industry 4.0",    ago: 4, read: false },
      { userId: emp.arjun.id,  msg: 'New task: "Prepare quarterly pipeline review" — due in 7 days',                  ago: 10, read: true },
      { userId: emp.neha.id,   msg: "You've been assigned a new lead: Cipla Kurkumbh Plant — Reverse Engineering",    ago: 2, read: false },
      { userId: emp.vikram.id, msg: "You've been assigned a new lead: Tata Motors Pune — 3D Scanning & Modeling",     ago: 5, read: true },
      { userId: emp.priya.id,  msg: 'New task: "Coordinate 3D scanning pilot at JSW Dolvi" — due in 3 days',          ago: 5, read: true },
      { userId: emp.rohan.id,  msg: 'New task: "Submit RFP response for Adani Mundra digital twin" — due in 2 days',  ago: 4, read: false },
    ]

    for (const n of empNotifs) {
      await prisma.notification.create({
        data: { userId: n.userId, message: n.msg, isRead: n.read, createdAt: daysAgo(n.ago) },
      })
    }

    console.log(`seeded ${adminNotifs.length + empNotifs.length} notifications`)
  } else {
    console.log(`${notifCount} notifications already present — skipped`)
  }

  // ── proposals, projects (auto-created on Won), and invoices/payments ───────
  // Deliberately not filtered by the lead's own status — a lead's pipeline
  // stage and its proposal's stage aren't kept in sync anywhere in this app
  // (see proposals.ts), so any lead can plausibly carry any proposal stage.

  const proposalCount = await prisma.proposal.count()
  if (proposalCount > 3) {
    console.log(`${proposalCount} proposals already present — skipping proposal/project/invoice seeding`)
  } else {
    console.log('seeding proposals, projects, invoices...')

    let proposalSeq = await prisma.proposal.count()
    const nextProposalNumber = () => `PROP-${String(++proposalSeq).padStart(4, '0')}`
    let workOrderSeq = await prisma.project.count()
    const nextWorkOrderNo = () => `WO-${String(++workOrderSeq).padStart(4, '0')}`
    let invoiceSeq = await prisma.invoice.count()
    const nextInvoiceNumber = () => `INV-${String(++invoiceSeq).padStart(4, '0')}`

    const allLeads = await prisma.lead.findMany({ where: { deletedAt: null }, include: { plant: true }, orderBy: { createdAt: 'asc' } })
    const wonLeads = allLeads.slice(0, 6)
    const progressLeads = allLeads.slice(6, 12)
    const lostLeads = allLeads.slice(12, 15)
    const openLeads = allLeads.slice(15, 19)

    const projectStageDefs = [
      { status: 'Completed',   billingStage: 'Fully Billed' },
      { status: 'In Progress', billingStage: 'Partial Billing' },
      { status: 'In Progress', billingStage: 'Advance Received' },
      { status: 'Not Started', billingStage: 'Not Started' },
    ]
    const stageLabels = ['Engagement', 'Contract', 'Program', 'Project']

    const createdProjects: { project: Awaited<ReturnType<typeof prisma.project.create>>; value: number }[] = []

    for (const [i, lead] of wonLeads.entries()) {
      const value = 1200000 + i * 350000
      const projectName = `${lead.plant.plantName} — ${stageLabels[i % stageLabels.length]}`
      const proposal = await prisma.proposal.create({
        data: {
          proposalNumber: nextProposalNumber(),
          leadId: lead.id,
          projectName,
          value,
          submissionDate: daysAgo(60 - i * 4),
          status: 'Won',
          probabilityPct: 100,
          expectedOrderDate: daysAgo(45 - i * 4),
          createdByUserId: admin.id,
        },
      })
      const stage = projectStageDefs[i % projectStageDefs.length]
      const project = await prisma.project.create({
        data: {
          workOrderNo: nextWorkOrderNo(),
          proposalId: proposal.id,
          leadId: lead.id,
          projectName,
          locationId: lead.plant.locationId,
          startDate: daysAgo(40 - i * 4),
          completionDate: stage.status === 'Completed' ? daysAgo(5) : null,
          responsibleUserId: lead.assignedToUserId,
          status: stage.status,
          billingStage: stage.billingStage,
          createdByUserId: admin.id,
        },
      })
      createdProjects.push({ project, value })
    }
    console.log(`seeded ${createdProjects.length} won proposals + projects`)

    const midStageStatuses = ['Negotiation', 'Follow-up', 'Submitted'] as const
    for (const [i, lead] of progressLeads.entries()) {
      await prisma.proposal.create({
        data: {
          proposalNumber: nextProposalNumber(),
          leadId: lead.id,
          projectName: `${lead.plant.plantName} — Proposal`,
          value: 400000 + i * 180000,
          submissionDate: daysAgo(20 - i * 2),
          status: midStageStatuses[i % midStageStatuses.length],
          probabilityPct: 40 + (i % 4) * 10,
          expectedOrderDate: daysFromNow(20 + i * 5),
          createdByUserId: admin.id,
        },
      })
    }
    console.log(`seeded ${progressLeads.length} in-progress proposals`)

    for (const [i, lead] of lostLeads.entries()) {
      await prisma.proposal.create({
        data: {
          proposalNumber: nextProposalNumber(),
          leadId: lead.id,
          projectName: `${lead.plant.plantName} — Proposal`,
          value: 300000 + i * 120000,
          submissionDate: daysAgo(35 - i * 3),
          status: 'Lost',
          probabilityPct: 0,
          createdByUserId: admin.id,
        },
      })
    }
    console.log(`seeded ${lostLeads.length} lost proposals`)

    for (const [i, lead] of openLeads.entries()) {
      await prisma.proposal.create({
        data: {
          proposalNumber: nextProposalNumber(),
          leadId: lead.id,
          projectName: `${lead.plant.plantName} — Draft Proposal`,
          value: 250000 + i * 90000,
          status: i % 2 === 0 ? 'Draft' : 'Submitted',
          probabilityPct: 15 + i * 5,
          createdByUserId: admin.id,
        },
      })
    }
    console.log(`seeded ${openLeads.length} early-stage proposals`)

    // Bill the first 3 won projects: one fully paid, one partially paid, one
    // still unpaid — covers every state the "Pending Payments" widget cares about.
    let invoicesSeeded = 0
    for (const [i, { project, value }] of createdProjects.slice(0, 3).entries()) {
      const amount = Math.round(value * 0.3)
      const invoice = await prisma.invoice.create({
        data: {
          invoiceNumber: nextInvoiceNumber(),
          projectId: project.id,
          amount,
          invoiceDate: daysAgo(15 - i * 3),
          dueDate: daysFromNow(15 - i * 10),
          status: 'Sent',
          createdByUserId: admin.id,
        },
      })
      if (i === 0) {
        await prisma.payment.create({ data: { invoiceId: invoice.id, amountReceived: amount, paymentDate: daysAgo(5), recordedByUserId: admin.id } })
        await prisma.invoice.update({ where: { id: invoice.id }, data: { status: 'Paid' } })
      } else if (i === 1) {
        await prisma.payment.create({ data: { invoiceId: invoice.id, amountReceived: Math.round(amount * 0.5), paymentDate: daysAgo(3), notes: 'Advance against milestone 1', recordedByUserId: admin.id } })
        await prisma.invoice.update({ where: { id: invoice.id }, data: { status: 'Partially Paid' } })
      }
      // i === 2 gets no payment — stays "Sent", feeding the Pending Payments widget.
      invoicesSeeded++
    }
    console.log(`seeded ${invoicesSeeded} invoices`)
  }

  // ── empanelments ─────────────────────────────────────────────────────────

  const empanelmentCount = await prisma.empanelment.count()
  if (empanelmentCount <= 3) {
    console.log('seeding empanelments...')
    const empanelmentDefs = [
      { client: clients.sail,      serviceType: serviceTypes.rbi,           status: 'Empanelled',   renewal: daysFromNow(180) },
      { client: clients.iocl,      serviceType: serviceTypes.tankInspection, status: 'Empanelled',  renewal: daysFromNow(90) },
      { client: clients.ntpc,      serviceType: serviceTypes.laserScanning, status: 'Under Review',  renewal: undefined },
      { client: clients.rinl,      serviceType: serviceTypes.bim,           status: 'Applied',      renewal: undefined },
      { client: clients.bpcl,      serviceType: serviceTypes.rbi,           status: 'Expired',      renewal: daysAgo(30) },
      { client: clients.ultratech, serviceType: serviceTypes.engineering,   status: 'Rejected',     renewal: undefined },
    ]
    for (const e of empanelmentDefs) {
      await prisma.empanelment.create({
        data: {
          clientId: e.client.id,
          serviceTypeId: e.serviceType.id,
          status: e.status,
          renewalDate: e.renewal ?? null,
          createdByUserId: admin.id,
        },
      })
    }
    console.log(`seeded ${empanelmentDefs.length} empanelments`)
  } else {
    console.log(`${empanelmentCount} empanelments already present — skipped`)
  }

  // ── tenders ───────────────────────────────────────────────────────────────

  const tenderCount = await prisma.tender.count()
  if (tenderCount <= 3) {
    console.log('seeding tenders...')
    const tenderDefs = [
      { no: 'SAIL/CE/2026/0142',   client: clients.sail,  value: 8500000, status: 'Under Evaluation', ago: 20 },
      { no: 'IOCL/HLD/2026/0087',  client: clients.iocl,  value: 4200000, status: 'Submitted',        ago: 12 },
      { no: 'NTPC/SIP/2026/0231',  client: clients.ntpc,  value: 6100000, status: 'Preparing',         ago: 5 },
      { no: 'RINL/VZ/2026/0019',   client: clients.rinl,  value: 3000000, status: 'Identified',        ago: 2 },
      { no: 'ADANI/MND/2025/0304', client: clients.adani, value: 5400000, status: 'Won',               ago: 45 },
    ]
    for (const t of tenderDefs) {
      await prisma.tender.create({
        data: {
          tenderNo: t.no,
          clientId: t.client.id,
          submissionDate: daysAgo(t.ago),
          value: t.value,
          status: t.status,
          createdByUserId: admin.id,
        },
      })
    }
    console.log(`seeded ${tenderDefs.length} tenders`)
  } else {
    console.log(`${tenderCount} tenders already present — skipped`)
  }
}

main()
  .then(() => console.log('\nseed complete'))
  .catch(e => { console.error('seed failed:', e.message); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
