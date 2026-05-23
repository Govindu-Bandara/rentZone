import toast from 'react-hot-toast';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

export default function ReceiptDownloadButton({
  targetId,
  bookingCode,
  className = '',
  style = {},
  children = 'Download Receipt',
}) {
  const downloadReceipt = async () => {
    try {
      const element = document.getElementById(targetId);
      if (!element) {
        toast.error('Receipt data not found');
        return;
      }

      const clone = element.cloneNode(true);
      clone.style.position = 'fixed';
      clone.style.left = '-9999px';
      clone.style.top = '-9999px';
      clone.style.width = `${element.offsetWidth}px`;
      clone.style.maxWidth = 'none';
      clone.style.height = 'auto';
      clone.style.overflow = 'visible';
      clone.style.transform = 'none';
      document.body.appendChild(clone);

      const canvas = await html2canvas(clone, {
        scale: 2,
        backgroundColor: '#ffffff',
        useCORS: true,
        allowTaint: true,
        logging: false,
        windowWidth: clone.scrollWidth,
        windowHeight: clone.scrollHeight,
        scrollX: 0,
        scrollY: 0,
      });

      document.body.removeChild(clone);

      const pdf = new jsPDF('p', 'mm', 'a4');
      const pageWidth = 210;
      const pageHeight = 297;
      const margin = 8;
      const usableWidth = pageWidth - margin * 2;
      const imgHeight = (canvas.height * usableWidth) / canvas.width;
      const imgData = canvas.toDataURL('image/png');

      pdf.addImage(imgData, 'PNG', margin, margin, usableWidth, imgHeight);

      if (imgHeight > pageHeight - margin * 2) {
        let heightLeft = imgHeight - (pageHeight - margin * 2);
        let offset = pageHeight - margin * 2;

        while (heightLeft > 0) {
          pdf.addPage();
          pdf.addImage(imgData, 'PNG', margin, margin - offset, usableWidth, imgHeight);
          heightLeft -= pageHeight - margin * 2;
          offset += pageHeight - margin * 2;
        }
      }

      const fileName = `RentZone_Receipt_${bookingCode || 'Booking'}_${Date.now()}.pdf`;
      pdf.save(fileName);
      toast.success('Receipt downloaded successfully!');
    } catch (err) {
      console.error('Error generating receipt:', err);
      toast.error('Failed to download receipt');
    }
  };

  return (
    <button type="button" className={className} style={style} onClick={downloadReceipt}>
      {children}
    </button>
  );
}