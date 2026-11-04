"use client";

// Dialog mengikuti ticketing POS: SweetAlert2 default + aksen sky yang sama.
import Swal from "sweetalert2";

const base = () => ({
  confirmButtonColor: "#0284c7",
  customClass: { popup: "pos-swal-popup" },
});

export const showSuccessToast = (message: string) =>
  Swal.fire({
    ...base(),
    toast: true,
    position: "top-end",
    icon: "success",
    title: message,
    showConfirmButton: false,
    timer: 1800,
    timerProgressBar: true,
  });

export const showInfoToast = (message: string) =>
  Swal.fire({
    ...base(),
    toast: true,
    position: "top-end",
    icon: "info",
    title: message,
    showConfirmButton: false,
    timer: 1800,
    timerProgressBar: true,
  });

export const showErrorAlert = (title: string, message: string) =>
  Swal.fire({
    ...base(),
    icon: "error",
    title,
    text: message,
    confirmButtonText: "Mengerti",
  });

export const showLogoutConfirm = () =>
  Swal.fire({
    ...base(),
    icon: "question",
    title: "Keluar dari dashboard?",
    text: "Sesi login Playbook akan diakhiri di perangkat ini.",
    confirmButtonText: "Ya, Logout",
    showCancelButton: true,
    cancelButtonText: "Batal",
    reverseButtons: true,
  }).then(r => r.isConfirmed);

type ConfirmOptions = {
  title: string;
  text?: string;
  confirmButtonText?: string;
  icon?: "warning" | "question" | "error" | "info";
};

export const confirmAction = (opts: ConfirmOptions) =>
  Swal.fire({
    ...base(),
    icon: opts.icon ?? "question",
    title: opts.title,
    text: opts.text,
    confirmButtonText: opts.confirmButtonText ?? "Ya",
    showCancelButton: true,
    cancelButtonText: "Batal",
    reverseButtons: true,
  }).then(r => r.isConfirmed);

export const promptText = (opts: ConfirmOptions & { inputValue?: string }) =>
  Swal.fire({
    ...base(),
    icon: opts.icon ?? "question",
    title: opts.title,
    text: opts.text,
    input: "text",
    inputValue: opts.inputValue,
    confirmButtonText: opts.confirmButtonText ?? "Lanjut",
    showCancelButton: true,
    cancelButtonText: "Batal",
    reverseButtons: true,
    inputValidator: v => (v?.trim() ? undefined : "Wajib diisi."),
  }).then(r => (r.isConfirmed ? String(r.value ?? "") : null));
