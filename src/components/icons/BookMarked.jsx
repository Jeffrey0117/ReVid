import { Icon } from './Icon';

export const BookMarked = ({ size, className, ...props }) => (
    <Icon size={size} className={className} {...props}>
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        <path d="M10 2v8l3-2 3 2V2" />
    </Icon>
);
