// Compile-time switches. Override from platformio.ini build_flags.
#pragma once

// LoRa transmit gate. 0 = receive-only firmware: no code path keys the
// transmitter. Set to 1 only after confirming FANET (868 MHz SRD) use is legal
// in Israel for this device and power level. Even with 1, TX also needs
// `tx arm` on the serial console after each boot (never persisted).
#ifndef PG_LORA_TX_ENABLED
#define PG_LORA_TX_ENABLED 0
#endif

// FANET transmit power, dBm at the chip. EU 868.0–868.6 MHz SRD allows 25 mW
// ERP (14 dBm) at 1 % duty cycle. Israel's rules may differ — part of the check.
#ifndef PG_LORA_TX_DBM
#define PG_LORA_TX_DBM 14
#endif

// Seconds between FANET tracking broadcasts once TX is armed. 0 = never.
#ifndef PG_FANET_TRACK_PERIOD_S
#define PG_FANET_TRACK_PERIOD_S 5
#endif

// BLE name the instrument advertises (the remote looks for it).
#ifndef PG_BLE_NAME
#define PG_BLE_NAME "PG-Instrument"
#endif

// Restrict remote commands to one BLE address, e.g. "aa:bb:cc:dd:ee:ff".
// Empty = accept any device that connects (fine on the bench, not in a crowd).
#ifndef PG_REMOTE_ALLOWED_ADDR
#define PG_REMOTE_ALLOWED_ADDR ""
#endif
