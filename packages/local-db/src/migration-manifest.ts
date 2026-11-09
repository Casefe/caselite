// DEV-1826：冻结两条已发布历史；不得从当前目录自动重新生成来接纳未知库。
export const integrationMigrations = [
  {
    tag: '0000_peaceful_hercules',
    when: 1793432207107,
    hash: 'ed2d933f3e5077c26540119dca56e4bd5c8386c1a01545f5bbe74986224459bf',
  },
  {
    tag: '0001_rapid_green_goblin',
    when: 1793866874915,
    hash: '657dede2b475894f2d9e170a38e1860423f62463459d2cea0190609e807dfe3a',
  },
  {
    tag: '0002_concerned_mandrill',
    when: 1793874186633,
    hash: '9bcb980fca9edfc3d13bf49ec975b72b1d91886f98e0096ff64a3a514c907480',
  },
  {
    tag: '0003_fat_morbius',
    when: 1793888591074,
    hash: '94d72227a82bd70ebe0742dc49e5b4532a0ffaa5c6f6aa067f7debad9973185e',
  },
  {
    tag: '0004_quiet_robin_chapel',
    when: 1793890132029,
    hash: '15a241b2a0de56c723d7a9c1c3edf33f7bbf7572b39b353983bd0c6c6348f456',
  },
  {
    tag: '0005_curly_gravity',
    when: 1793937003718,
    hash: '7d7b442c299420eff5f8b95213dde0ab7a89918f68f8ddbedea400ae709f03bf',
  },
  {
    tag: '0006_colorful_timeslip',
    when: 1794005568886,
    hash: '8f444a43e7353f70998a96479d53c601229f8a1de4ed1ec664e2804cbe136aae',
  },
  {
    tag: '0007_brainy_anthem',
    when: 1794007444784,
    hash: '71678039ca30f45fddfe8548ebbc80efaa071b6e4dc67f4d14ddc0930ebf3487',
  },
  {
    tag: '0008_open_marauders',
    when: 1794008945029,
    hash: '76a50d1e53c8cc49fea481e73bea33e2d7a81d939b2d1ba9e8a17aed7c8492ca',
  },
  {
    tag: '0009_wakeful_the_captain',
    when: 1794017107803,
    hash: 'bb388e5f3a4ae037315af4cd57dc56944fe54c0cc6ce48302ab1f6399e2e45fc',
  },
  {
    tag: '0010_greedy_paibok',
    when: 1794019792324,
    hash: 'e05150641753bd72f378687518f3d51f60c657d873a2821eb871aacd0a8f104c',
  },
  {
    tag: '0011_watery_triathlon',
    when: 1794026024659,
    hash: '5ca7e36f292b7199625509e6d35dc95765623b03c4634409ef28507678931b85',
  },
  {
    tag: '0012_complete_red_ghost',
    when: 1794033159086,
    hash: 'c57b0871305b2811bec665f7f91da01e38c367b66872e525acb5a2a3d1bdd767',
  },
  {
    tag: '0013_task_comment',
    when: 1794034693656,
    hash: '0e9469d981d8afc981b7d5fee946df12717f6257350b7c999ad556325be81996',
  },
  {
    tag: '0014_task_local_assignee',
    when: 1794039233450,
    hash: '62cc72a44084d1c85b5e20b114e002dcf2bc0f78cbd261773ad0008eafc29690',
  },
  {
    tag: '0015_finance_ledger',
    when: 1794048473522,
    hash: '93940378d591cb8de5483f5d888d042f5d24d5501ef9b083969f568cd45da738',
  },
  {
    tag: '0016_local_contacts',
    when: 1794063000000,
    hash: 'b5fc9dddd6d845107e1e42dcf050d70fc6b53cbc20581976ea813b850ddc4b4d',
  },
  {
    tag: '0017_task_subscription',
    when: 1794064000000,
    hash: '28244a25822f7fe7d2a43dbcad48397b9fba36f84b6954826542f8a4a7ee0141',
  },
  {
    tag: '0018_project_update_health',
    when: 1794065000000,
    hash: '4fd81d0424c3b5c540d3f8439ab9df713c938147f9fc117fdbed83c1d5258d6a',
  },
  {
    tag: '0019_project_milestones',
    when: 1794066000000,
    hash: '32bdcd5867db393f70419af63917972f8a8994ba9b71b084526d2f73707ac938',
  },
  {
    tag: '0017_deliverable_snapshots',
    when: 1794135025841,
    hash: 'cfd6cfecff06c9c2583af7b8754c4d92dd4348ddb28975659599d98cabfcc044',
  },
  {
    tag: '0018_delivery_exports',
    when: 1794137445427,
    hash: 'd668777fcc12c27884a54af8ae4c97d62571068514d13be5256b0a060b7235ff',
  },
  {
    tag: '0019_local_preferences',
    when: 1794148124422,
    hash: 'f419d4d28e4d47ddce6c7af2fea70194d9e5434a06fd31a25f9d604e07a88bb6',
  },
  {
    tag: '0020_task_calendar',
    when: 1794183600000,
    hash: '5b0d919bb3797970835b8bfa0d8ae1324949a81ab844bd20ad730ec539e45ec1',
  },
  {
    tag: '0021_important_date_confirmation',
    when: 1794190800000,
    hash: 'c5afdd3360a07602dbf908c6df151911e99200aee6d39071308efd0e6d569fe9',
  },
] as const;
