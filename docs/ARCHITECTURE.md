# Architecture

Mobile app -> Discover API gateway -> observation service -> isolated observation store and private object storage -> extraction/matching/quality pipeline -> approved Harmony adapter -> Journey API.

The app must never access privileged database credentials directly.

Observation evidence, canonical intelligence, and personal consumer data are separate domains.

Original images remain immutable evidence; derived crops and OCR outputs are separate artifacts. Consumer submissions are not canonical menu facts until they pass defined quality and promotion rules.
